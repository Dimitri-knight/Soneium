// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IEAS, AttestationRequest, AttestationRequestData } from "@ethereum-attestation-service/eas-contracts/contracts/IEAS.sol";
import { EMPTY_UID, NO_EXPIRATION_TIME } from "@ethereum-attestation-service/eas-contracts/contracts/Common.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { RightsRegistry } from "./RightsRegistry.sol";

/**
 * @title RoyaltySettlement
 * @notice Pays a royalty, then attests, in one transaction — the
 * blockchain record must not exist unless the required payment
 * succeeded. Registered as an authorized attester on CopySightResolver
 * (via its existing authorizeAttester(), same as any signer key), so
 * the resolver itself needs no changes: `attestation.attester` here is
 * this contract's own address.
 *
 * @dev payAndRegister is restricted to owner-authorized submitters (the
 * same trusted backend key the rest of this system already uses to
 * submit plain attestations) — it is NOT open to arbitrary callers.
 * CopySightResolver's entire security model is "only our backend's
 * trusted attester key can ever produce a valid attestation"; since this
 * contract is itself an authorized attester, leaving payAndRegister
 * callable by anyone would let a stranger forge a resolver-accepted
 * "CopySight-verified" attestation (or squat an unclaimed assetHash for
 * free) with zero real analysis ever having run. Restricting the caller
 * preserves that same trust boundary for the royalty path.
 *
 * The real payer is a separate, explicit parameter rather than
 * msg.sender, specifically so the trusted submitter can submit on a real
 * end user's behalf (same "backend submits, user never needs gas or to
 * sign the submission tx" model already used everywhere else) while the
 * actual token movement is still correctly attributed to that user's own
 * wallet. The user still has to approve() this contract from their own
 * wallet beforehand — that one step only the token owner can do — but
 * they never need to call payAndRegister themselves.
 *
 * Three cases, resolved by looking up RightsRegistry (never trusting a
 * caller-supplied price):
 *  - This exact asset was already claimed by someone other than the
 *    payer (a copy/re-submission) -> pay that rights holder.
 *  - No claim exists yet, but this matches a known external IP -> pay
 *    that IP's registered rights holder.
 *  - No claim and no known-IP match, and CopyScore is 0 (clean) -> the
 *    payer becomes the asset's rights holder going forward, no payment.
 *  - No claim, no known-IP match, and CopyScore > 0 -> nothing to pay
 *    (no registered rights holder to pay yet); the attestation still
 *    proceeds, since an unidentified similarity isn't itself a reason to
 *    block registration.
 *  - The payer IS the already-registered rights holder for this asset
 *    (re-checking their own work) -> never pay themselves, regardless of
 *    copyScore — no transfer is attempted and no RoyaltyPaid event fires.
 *
 * nonReentrant guards payAndRegister because paymentToken is
 * attacker-choosable (whoever registers or sets terms on an asset picks
 * it). msg.sender for a reentrant call from inside transferFrom is the
 * token contract itself, not the real payer, so a malicious token can't
 * double-charge them directly — but since RightsRegistry authorizes this
 * contract, not the token, a reentrant call could still reach
 * registerIfClear and self-register an entirely unrelated, unclaimed
 * asset for free, riding on someone else's real payment transaction (see
 * test_reentrancyGuardBlocksPiggybackedRegistrationDuringPayment). With
 * the guard, that reentrant call reverts, and so does the whole outer
 * transaction — nothing gets smuggled in.
 */
contract RoyaltySettlement is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    event RoyaltyPaid(bytes32 indexed assetHash, address indexed payer, address indexed rightsHolder, uint256 amount, address paymentToken);
    event SubmitterAuthorized(address indexed submitter);
    event SubmitterDeauthorized(address indexed submitter);

    error InvalidCopyScore(uint8 copyScore);
    error UnauthorizedSubmitter(address submitter);

    IEAS public immutable eas;
    RightsRegistry public immutable registry;
    bytes32 public immutable schemaUID;

    mapping(address => bool) public isAuthorizedSubmitter;

    modifier onlyAuthorizedSubmitter() {
        _checkAuthorizedSubmitter();
        _;
    }

    function _checkAuthorizedSubmitter() private view {
        if (!isAuthorizedSubmitter[msg.sender]) {
            revert UnauthorizedSubmitter(msg.sender);
        }
    }

    constructor(IEAS _eas, RightsRegistry _registry, bytes32 _schemaUID, address initialOwner) Ownable(initialOwner) {
        eas = _eas;
        registry = _registry;
        schemaUID = _schemaUID;
    }

    /// @notice Authorizes a wallet (the backend's existing attester key) to call payAndRegister on behalf of real payers.
    function authorizeSubmitter(address submitter) external onlyOwner {
        isAuthorizedSubmitter[submitter] = true;
        emit SubmitterAuthorized(submitter);
    }

    function deauthorizeSubmitter(address submitter) external onlyOwner {
        isAuthorizedSubmitter[submitter] = false;
        emit SubmitterDeauthorized(submitter);
    }

    /// @param payer The real payer's wallet. Must have approved this contract to spend `paymentToken` beforehand (their own wallet-signed action) — this call itself is made by an authorized submitter on their behalf, not by the payer directly.
    /// @param knownIPId Pass bytes32(0) unless this submission matches a known external IP (see RightsRegistry.registerKnownIP).
    function payAndRegister(
        address payer,
        bytes32 assetHash,
        bytes32 analysisHash,
        uint8 copyScore,
        bytes32 analysisVersionHash,
        bytes32 knownIPId
    ) external onlyAuthorizedSubmitter nonReentrant returns (bytes32 uid) {
        // Fail fast rather than attempting a payment for a score the
        // resolver would reject anyway once eas.attest() runs — same
        // outcome (revert), less wasted gas on the way there.
        if (copyScore > 100) {
            revert InvalidCopyScore(copyScore);
        }

        RightsRegistry.RightsRecord memory holder = registry.getAssetRights(assetHash);

        if (holder.rightsHolder == address(0) && knownIPId != bytes32(0)) {
            holder = registry.getKnownIPRights(knownIPId);
        }

        if (holder.rightsHolder == address(0)) {
            if (copyScore == 0) {
                registry.registerIfClear(assetHash, payer, 0, address(0));
            }
        } else if (holder.rightsHolder != payer) {
            uint256 royalty = (holder.basePrice * copyScore) / 100;
            if (royalty > 0) {
                IERC20(holder.paymentToken).safeTransferFrom(payer, holder.rightsHolder, royalty);
                emit RoyaltyPaid(assetHash, payer, holder.rightsHolder, royalty, holder.paymentToken);
            }
        }

        uid = eas.attest(
            AttestationRequest({
                schema: schemaUID,
                data: AttestationRequestData({
                    recipient: address(0),
                    expirationTime: NO_EXPIRATION_TIME,
                    revocable: false,
                    refUID: EMPTY_UID,
                    data: abi.encode(assetHash, analysisHash, copyScore, analysisVersionHash),
                    value: 0
                })
            })
        );
    }
}
