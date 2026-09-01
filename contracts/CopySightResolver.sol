// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { SchemaResolver } from "@ethereum-attestation-service/eas-contracts/contracts/resolver/SchemaResolver.sol";
import { IEAS, Attestation } from "@ethereum-attestation-service/eas-contracts/contracts/IEAS.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CopySightResolver
 * @notice Attached to the CopySight_ipAnalysis EAS schema:
 *   bytes32 assetHash, bytes32 analysisHash, uint8 copyScore, bytes32 analysisVersionHash
 *
 * Implements the four responsibilities named on the architect's
 * production-milestone diagram:
 *   1. Authorized CopySight attesters only
 *   2. Payload validation
 *   3. CopyScore 0-100 validation
 *   4. Revocation validation
 * Signer rotation is owner-controlled add/remove of authorized
 * attesters — supports more than one at a time, unlike EAS's own
 * single-address AttesterResolver example.
 *
 * IMPORTANT — verified against EAS's actual EAS.sol source, not assumed:
 * EAS's core _revoke() already enforces "only the original attester may
 * revoke their own attestation" BEFORE this resolver's onRevoke() ever
 * runs, and it's structurally impossible to revoke an attestation issued
 * under a schema registered with revocable=false in the first place. So
 * onRevoke() below is only ever reachable at all if
 * CopySightAnalysisSchema.ts's `revocable` flag is set to true — it
 * currently defaults to false. That open question now has a concrete
 * consequence: if false stands, this entire onRevoke() path is dead
 * code, which is fine; if the production design wants real revocation,
 * this is where a rule beyond EAS's own "original attester only" check
 * lives. Confirm with Architect either way.
 *
 * Deliberately NOT built: pause switches, upgradeability, fee logic —
 * matches the "don't overbuild it" direction that's shaped this whole
 * project. Add only when a real need is identified, same as this
 * contract itself was.
 */
contract CopySightResolver is SchemaResolver, Ownable {
    event AttesterAuthorized(address indexed attester);
    event AttesterDeauthorized(address indexed attester);

    error UnauthorizedAttester(address attester);
    error InvalidPayloadLength(uint256 length);
    error InvalidCopyScore(uint8 copyScore);
    error AttesterNoLongerAuthorized(address attester);

    /// @dev 4 static fields (bytes32, bytes32, uint8, bytes32), each
    /// padded to one 32-byte ABI word. Verified empirically against the
    /// real SchemaEncoder output, not just assumed — see the dedicated
    /// length assertion in attestationCodec.test.ts, which fails loudly
    /// if the schema ever changes shape without this being updated too.
    uint256 private constant EXPECTED_DATA_LENGTH = 128;

    mapping(address => bool) public isAuthorizedAttester;

    constructor(
        IEAS eas,
        address initialAttester,
        address initialOwner
    ) SchemaResolver(eas) Ownable(initialOwner) {
        _setAuthorized(initialAttester, true);
    }

    /// @notice Adds an address to the authorized-attester set. Owner-only — this is the "signer rotation" mechanism.
    function authorizeAttester(address attester) external onlyOwner {
        _setAuthorized(attester, true);
    }

    /// @notice Removes an address from the authorized-attester set.
    function deauthorizeAttester(address attester) external onlyOwner {
        _setAuthorized(attester, false);
    }

    function _setAuthorized(address attester, bool authorized) private {
        isAuthorizedAttester[attester] = authorized;
        if (authorized) {
            emit AttesterAuthorized(attester);
        } else {
            emit AttesterDeauthorized(attester);
        }
    }

    /// @dev Called by EAS itself whenever an attestation is created against this schema.
    function onAttest(
        Attestation calldata attestation,
        uint256 /* value */
    ) internal view override returns (bool) {
        if (!isAuthorizedAttester[attestation.attester]) {
            revert UnauthorizedAttester(attestation.attester);
        }
        if (attestation.data.length != EXPECTED_DATA_LENGTH) {
            revert InvalidPayloadLength(attestation.data.length);
        }

        (, , uint8 copyScore, ) = abi.decode(attestation.data, (bytes32, bytes32, uint8, bytes32));
        if (copyScore > 100) {
            revert InvalidCopyScore(copyScore);
        }

        return true;
    }

    /// @dev Called by EAS itself whenever a revocation is attempted. By
    /// this point EAS core has ALREADY verified the caller is the
    /// original attester (see contract-level note) — msg.sender here is
    /// the EAS contract, not the revoker, so it can't be checked
    /// directly. The rule added on top: an attester that's since been
    /// deauthorized (rotated out) can't revoke their old attestations
    /// either. Policy choice — confirm with Architect.
    function onRevoke(
        Attestation calldata attestation,
        uint256 /* value */
    ) internal view override returns (bool) {
        if (!isAuthorizedAttester[attestation.attester]) {
            revert AttesterNoLongerAuthorized(attestation.attester);
        }
        return true;
    }
}
