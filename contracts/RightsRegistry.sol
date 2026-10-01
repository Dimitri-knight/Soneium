// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RightsRegistry
 * @notice Tracks who should be paid a royalty when a later submission
 * matches an asset — either a creator's own previously-registered
 * original (keyed by assetHash), or a known external IP like a
 * celebrity or brand (keyed by an admin-assigned IP id, since a new
 * infringing-looking file never shares an assetHash with the IP it
 * resembles).
 *
 * @dev Only authorized callers (RoyaltySettlement) can write a new
 * self-registration — otherwise anyone could claim any assetHash
 * directly, bypassing analysis and payment entirely. Known-IP entries
 * are owner-only, since populating those depends on real rights
 * relationships this contract has no way to verify itself.
 */
contract RightsRegistry is Ownable {
    struct RightsRecord {
        address rightsHolder;
        uint256 basePrice;
        address paymentToken;
    }

    event CallerAuthorized(address indexed caller);
    event CallerDeauthorized(address indexed caller);
    event AssetRegistered(bytes32 indexed assetHash, address indexed rightsHolder, uint256 basePrice, address paymentToken);
    event AssetTermsUpdated(bytes32 indexed assetHash, uint256 basePrice, address paymentToken);
    event KnownIPRegistered(bytes32 indexed ipId, address indexed rightsHolder, uint256 basePrice, address paymentToken);

    error UnauthorizedCaller(address caller);
    error AlreadyRegistered(bytes32 key);
    error NotRightsHolder(bytes32 assetHash, address caller);
    error InvalidRightsHolder();
    error InvalidPaymentToken();
    error InvalidIPId();

    mapping(address => bool) public isAuthorizedCaller;
    mapping(bytes32 => RightsRecord) private assetRights;
    mapping(bytes32 => RightsRecord) private knownIPRights;

    modifier onlyAuthorizedCaller() {
        _checkAuthorizedCaller();
        _;
    }

    function _checkAuthorizedCaller() private view {
        if (!isAuthorizedCaller[msg.sender]) {
            revert UnauthorizedCaller(msg.sender);
        }
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Authorizes a contract (the RoyaltySettlement instance) to self-register clean assets on a claimant's behalf.
    function authorizeCaller(address caller) external onlyOwner {
        isAuthorizedCaller[caller] = true;
        emit CallerAuthorized(caller);
    }

    function deauthorizeCaller(address caller) external onlyOwner {
        isAuthorizedCaller[caller] = false;
        emit CallerDeauthorized(caller);
    }

    /// @notice First-time claim on a clean asset — the submitting wallet becomes its rights holder. Reverts if already claimed.
    function registerIfClear(
        bytes32 assetHash,
        address claimant,
        uint256 basePrice,
        address paymentToken
    ) external onlyAuthorizedCaller {
        if (assetRights[assetHash].rightsHolder != address(0)) {
            revert AlreadyRegistered(assetHash);
        }
        assetRights[assetHash] = RightsRecord({ rightsHolder: claimant, basePrice: basePrice, paymentToken: paymentToken });
        emit AssetRegistered(assetHash, claimant, basePrice, paymentToken);
    }

    /// @notice Lets the current rights holder for an asset set or change what a match should cost. Self-registration alone doesn't set a price (a creator may not know it yet, or may want reuse to stay free) — this is the deliberate, separate step for declaring one.
    function setTerms(bytes32 assetHash, uint256 basePrice, address paymentToken) external {
        RightsRecord storage record = assetRights[assetHash];
        if (record.rightsHolder != msg.sender) {
            revert NotRightsHolder(assetHash, msg.sender);
        }
        if (basePrice > 0 && paymentToken == address(0)) {
            revert InvalidPaymentToken();
        }
        record.basePrice = basePrice;
        record.paymentToken = paymentToken;
        emit AssetTermsUpdated(assetHash, basePrice, paymentToken);
    }

    /// @notice Admin-populated entry for a known external IP (a celebrity, a brand) — real rights-holder data comes from outside this contract.
    function registerKnownIP(
        bytes32 ipId,
        address rightsHolder,
        uint256 basePrice,
        address paymentToken
    ) external onlyOwner {
        if (rightsHolder == address(0)) {
            revert InvalidRightsHolder();
        }
        if (ipId == bytes32(0)) {
            revert InvalidIPId();
        }
        if (basePrice > 0 && paymentToken == address(0)) {
            revert InvalidPaymentToken();
        }
        knownIPRights[ipId] = RightsRecord({ rightsHolder: rightsHolder, basePrice: basePrice, paymentToken: paymentToken });
        emit KnownIPRegistered(ipId, rightsHolder, basePrice, paymentToken);
    }

    function getAssetRights(bytes32 assetHash) external view returns (RightsRecord memory) {
        return assetRights[assetHash];
    }

    function getKnownIPRights(bytes32 ipId) external view returns (RightsRecord memory) {
        return knownIPRights[ipId];
    }
}
