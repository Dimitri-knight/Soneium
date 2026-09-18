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
 * @dev Enforces: authorized attesters only, payload length, copyScore
 * range, and revocation eligibility. Signer rotation is owner-controlled
 * add/remove of authorized attesters, supporting more than one at a time
 * (unlike EAS's single-address AttesterResolver example).
 *
 * EAS's core _revoke() already enforces that only the original attester
 * may revoke their own attestation, before onRevoke() below ever runs,
 * and revocation is impossible at all under a schema registered with
 * revocable=false. Since CopySightAnalysisSchema.ts sets revocable to
 * false, onRevoke() is effectively dead code today — kept as a cheap
 * switch to flip if real revocation is needed later; corrections
 * currently happen by superseding an attestation via `refUID` instead.
 *
 * Deliberately not built: pause switches, upgradeability, fee logic.
 */
contract CopySightResolver is SchemaResolver, Ownable {
    event AttesterAuthorized(address indexed attester);
    event AttesterDeauthorized(address indexed attester);

    error UnauthorizedAttester(address attester);
    error InvalidPayloadLength(uint256 length);
    error InvalidCopyScore(uint8 copyScore);
    error AttesterNoLongerAuthorized(address attester);

    /// @dev 4 static fields (bytes32, bytes32, uint8, bytes32), each
    /// padded to one 32-byte ABI word. See the length assertion in
    /// attestationCodec.test.ts, which fails if the schema shape changes
    /// without this being updated too.
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

    /// @dev Called by EAS itself whenever a revocation is attempted. EAS
    /// core has already verified the caller is the original attester by
    /// this point (msg.sender here is the EAS contract, not the
    /// revoker). Adds the extra rule that a deauthorized attester can't
    /// revoke their old attestations either. Unreachable while the
    /// schema stays non-revocable (see contract-level note).
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
