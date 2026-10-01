// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { SchemaRegistry } from "@ethereum-attestation-service/eas-contracts/contracts/SchemaRegistry.sol";
import { ISchemaRegistry } from "@ethereum-attestation-service/eas-contracts/contracts/ISchemaRegistry.sol";
import { EAS } from "@ethereum-attestation-service/eas-contracts/contracts/EAS.sol";
import { IEAS } from "@ethereum-attestation-service/eas-contracts/contracts/IEAS.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { CopySightResolver } from "../CopySightResolver.sol";
import { RightsRegistry } from "../RightsRegistry.sol";
import { RoyaltySettlement } from "../RoyaltySettlement.sol";

/// @dev Minimal test-only ERC20 — mints freely, no other logic needed for these tests.
contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MOCK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev A payment token whose transferFrom piggybacks an unrelated call
/// back into payAndRegister. msg.sender for that reentrant call is this
/// token contract itself (not the real payer — Solidity doesn't let a
/// reentrant call impersonate the original caller), so it can't double-
/// charge the payer directly. What it *can* do without a guard: since
/// RoyaltySettlement (not the token) is what's authorized on the
/// registry, the reentrant call still reaches registerIfClear — letting
/// the token self-register an entirely unrelated, still-unclaimed asset
/// for free, riding on someone else's real payment transaction.
contract ReentrantERC20 is ERC20 {
    RoyaltySettlement public target;
    bytes32 public piggybackAssetHash;
    bool public attacked;

    constructor() ERC20("Evil", "EVIL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setAttack(RoyaltySettlement _target, bytes32 _piggybackAssetHash) external {
        target = _target;
        piggybackAssetHash = _piggybackAssetHash;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (address(target) != address(0) && !attacked) {
            attacked = true;
            target.payAndRegister(from, piggybackAssetHash, keccak256("evil-analysis"), 0, keccak256("evil-version"), bytes32(0));
        }
        return super.transferFrom(from, to, amount);
    }
}

/// @notice Deploys the real SchemaRegistry, EAS, and CopySightResolver locally
/// (not mocks) so this proves RoyaltySettlement's design actually works
/// against the real resolver without needing any change to it —
/// RoyaltySettlement is just authorized as an attester the same way a
/// human signer key would be.
contract RoyaltySettlementTest is Test {
    SchemaRegistry schemaRegistry;
    EAS eas;
    CopySightResolver resolver;
    RightsRegistry registry;
    RoyaltySettlement settlement;
    MockERC20 token;

    address owner = makeAddr("owner");
    address humanAttester = makeAddr("humanAttester"); // the existing backend signer — untouched by any of this
    address submitter = makeAddr("submitter"); // the backend key authorized to call payAndRegister on behalf of real payers
    address creator = makeAddr("creator");
    address payer = makeAddr("payer");

    bytes32 schemaUID;

    string constant SCHEMA = "bytes32 assetHash, bytes32 analysisHash, uint8 copyScore, bytes32 analysisVersionHash";

    function setUp() public {
        schemaRegistry = new SchemaRegistry();
        eas = new EAS(ISchemaRegistry(address(schemaRegistry)));
        resolver = new CopySightResolver(eas, humanAttester, owner);
        schemaUID = schemaRegistry.register(SCHEMA, resolver, false);

        registry = new RightsRegistry(owner);
        settlement = new RoyaltySettlement(IEAS(address(eas)), registry, schemaUID, owner);
        token = new MockERC20();

        vm.startPrank(owner);
        resolver.authorizeAttester(address(settlement)); // no code change to the resolver — same mechanism as rotating a human key
        registry.authorizeCaller(address(settlement));
        settlement.authorizeSubmitter(submitter);
        vm.stopPrank();
    }

    function _payload(bytes32 assetHash, uint8 copyScore) internal pure returns (bytes32, bytes32, uint8, bytes32) {
        return (assetHash, keccak256("analysis"), copyScore, keccak256("v1"));
    }

    function test_unauthorizedSubmitterCannotCallPayAndRegister() public {
        (bytes32 assetHash, bytes32 analysisHash, uint8 copyScore, bytes32 analysisVersionHash) = _payload(keccak256("clean-asset"), 0);

        // payer tries to call directly instead of going through the authorized submitter.
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(RoyaltySettlement.UnauthorizedSubmitter.selector, payer));
        settlement.payAndRegister(payer, assetHash, analysisHash, copyScore, analysisVersionHash, bytes32(0));
    }

    function test_ownerCanAuthorizeAndDeauthorizeSubmitters() public {
        address newSubmitter = makeAddr("newSubmitter");
        assertFalse(settlement.isAuthorizedSubmitter(newSubmitter));

        vm.prank(owner);
        settlement.authorizeSubmitter(newSubmitter);
        assertTrue(settlement.isAuthorizedSubmitter(newSubmitter));

        vm.prank(owner);
        settlement.deauthorizeSubmitter(newSubmitter);
        assertFalse(settlement.isAuthorizedSubmitter(newSubmitter));

        // Not just the flag — a real call must actually be blocked.
        (bytes32 assetHash, bytes32 analysisHash, uint8 copyScore, bytes32 analysisVersionHash) =
            _payload(keccak256("post-deauth-asset"), 0);
        vm.prank(newSubmitter);
        vm.expectRevert(abi.encodeWithSelector(RoyaltySettlement.UnauthorizedSubmitter.selector, newSubmitter));
        settlement.payAndRegister(creator, assetHash, analysisHash, copyScore, analysisVersionHash, bytes32(0));
    }

    function test_nonOwnerCannotAuthorizeSubmitters() public {
        vm.prank(creator);
        vm.expectRevert();
        settlement.authorizeSubmitter(creator);
    }

    function test_firstTimeCleanAssetSelfRegistersWithNoPayment() public {
        (bytes32 assetHash, bytes32 analysisHash, uint8 copyScore, bytes32 analysisVersionHash) = _payload(keccak256("clean-asset"), 0);

        vm.prank(submitter);
        bytes32 uid = settlement.payAndRegister(creator, assetHash, analysisHash, copyScore, analysisVersionHash, bytes32(0));

        assertTrue(uid != bytes32(0));
        RightsRegistry.RightsRecord memory record = registry.getAssetRights(assetHash);
        assertEq(record.rightsHolder, creator);
    }

    function test_matchAgainstExistingHolderPaysRoyaltyAndAttests() public {
        bytes32 assetHash = keccak256("popular-asset");

        // Establish the original rights holder first, with a real price.
        vm.prank(owner);
        registry.authorizeCaller(address(this)); // test contract stands in as an authorized caller for setup only
        registry.registerIfClear(assetHash, creator, 100, address(token));

        token.mint(payer, 1_000);
        vm.prank(payer); // only the real payer's own wallet can approve its own tokens
        token.approve(address(settlement), 1_000);

        (, bytes32 analysisHash, uint8 copyScore, bytes32 analysisVersionHash) = _payload(assetHash, 75);

        vm.prank(submitter);
        bytes32 uid = settlement.payAndRegister(payer, assetHash, analysisHash, copyScore, analysisVersionHash, bytes32(0));

        assertTrue(uid != bytes32(0));
        assertEq(token.balanceOf(creator), 75); // 100 * 75 / 100
        assertEq(token.balanceOf(payer), 1_000 - 75);
    }

    function test_matchAgainstKnownExternalIPPaysThatRightsHolder() public {
        bytes32 ipId = keccak256("Millie Bobby Brown");
        address ipRightsHolder = makeAddr("ipRightsHolder");

        vm.prank(owner);
        registry.registerKnownIP(ipId, ipRightsHolder, 200, address(token));

        token.mint(payer, 1_000);
        vm.prank(payer);
        token.approve(address(settlement), 1_000);

        (bytes32 assetHash, bytes32 analysisHash, uint8 copyScore, bytes32 analysisVersionHash) = _payload(keccak256("new-upload"), 95);

        vm.prank(submitter);
        bytes32 uid = settlement.payAndRegister(payer, assetHash, analysisHash, copyScore, analysisVersionHash, ipId);

        assertTrue(uid != bytes32(0));
        assertEq(token.balanceOf(ipRightsHolder), 190); // 200 * 95 / 100
    }

    function test_noKnownHolderMeansNoPaymentButAttestationStillProceeds() public {
        (bytes32 assetHash, bytes32 analysisHash, uint8 copyScore, bytes32 analysisVersionHash) = _payload(keccak256("unidentified-similarity"), 60);

        vm.prank(submitter);
        bytes32 uid = settlement.payAndRegister(payer, assetHash, analysisHash, copyScore, analysisVersionHash, bytes32(0));

        assertTrue(uid != bytes32(0)); // nothing to pay, but a real record still exists
    }

    function test_insufficientApprovalBlocksBothPaymentAndAttestation() public {
        bytes32 assetHash = keccak256("popular-asset-2");

        vm.prank(owner);
        registry.authorizeCaller(address(this));
        registry.registerIfClear(assetHash, creator, 100, address(token));

        // payer never approved the settlement contract to spend any tokens
        (, bytes32 analysisHash, uint8 copyScore, bytes32 analysisVersionHash) = _payload(assetHash, 50);

        vm.prank(submitter);
        vm.expectRevert();
        settlement.payAndRegister(payer, assetHash, analysisHash, copyScore, analysisVersionHash, bytes32(0));
    }

    function test_invalidCopyScoreRevertsBeforeAttemptingPayment() public {
        bytes32 assetHash = keccak256("popular-asset-3");

        vm.prank(owner);
        registry.authorizeCaller(address(this));
        registry.registerIfClear(assetHash, creator, 100, address(token));

        token.mint(payer, 1_000);
        vm.prank(payer);
        token.approve(address(settlement), 1_000);

        (, bytes32 analysisHash, , bytes32 analysisVersionHash) = _payload(assetHash, 0);

        vm.prank(submitter);
        vm.expectRevert(abi.encodeWithSelector(RoyaltySettlement.InvalidCopyScore.selector, 150));
        settlement.payAndRegister(payer, assetHash, analysisHash, 150, analysisVersionHash, bytes32(0));

        // Nothing was pulled — the check happens before any transferFrom.
        assertEq(token.balanceOf(payer), 1_000);
    }

    function test_selfResubmissionOfFreeCleanAssetNeedsNoApproval() public {
        (bytes32 assetHash, bytes32 analysisHash, uint8 copyScore, bytes32 analysisVersionHash) = _payload(keccak256("my-own-clean-asset"), 0);

        vm.prank(submitter);
        settlement.payAndRegister(creator, assetHash, analysisHash, copyScore, analysisVersionHash, bytes32(0));

        // Re-submitting the same asset, still clean (score 0): the payer
        // IS the registered rights holder, so the payment branch is
        // skipped entirely regardless of score — see the next test for
        // the nonzero-score case.
        vm.prank(submitter);
        bytes32 uid = settlement.payAndRegister(creator, assetHash, analysisHash, copyScore, analysisVersionHash, bytes32(0));
        assertTrue(uid != bytes32(0));
    }

    function test_rightsHolderNeverPaysThemselvesEvenAtNonZeroCopyScore() public {
        (bytes32 assetHash, bytes32 analysisHash, , bytes32 analysisVersionHash) = _payload(keccak256("creators-own-priced-asset"), 0);

        // Creator self-registers free, then sets a real price.
        vm.prank(submitter);
        settlement.payAndRegister(creator, assetHash, analysisHash, 0, analysisVersionHash, bytes32(0));
        vm.prank(creator);
        registry.setTerms(assetHash, 300, address(token));

        // Creator re-checks their OWN asset later and it naturally scores
        // high against itself (realistic: re-analysis of the same file).
        // No approval was ever given — this must still succeed, and must
        // not attempt any transfer, because the payer IS the rights holder.
        vm.prank(submitter);
        bytes32 uid = settlement.payAndRegister(creator, assetHash, analysisHash, 100, analysisVersionHash, bytes32(0));

        assertTrue(uid != bytes32(0));
        assertEq(token.balanceOf(creator), 0); // never paid themselves
    }

    function test_fullFlowSelfRegisterThenSetTermsThenGetPaid() public {
        (bytes32 assetHash, bytes32 analysisHash, uint8 copyScore, bytes32 analysisVersionHash) = _payload(keccak256("real-creator-asset"), 0);

        // Creator registers for free first (doesn't know their price yet).
        vm.prank(submitter);
        settlement.payAndRegister(creator, assetHash, analysisHash, copyScore, analysisVersionHash, bytes32(0));

        // Later, decides what a match should cost.
        vm.prank(creator);
        registry.setTerms(assetHash, 300, address(token));

        token.mint(payer, 1_000);
        vm.prank(payer);
        token.approve(address(settlement), 1_000);

        (, bytes32 laterAnalysisHash, uint8 laterCopyScore, bytes32 laterVersionHash) = _payload(assetHash, 80);

        vm.prank(submitter);
        bytes32 uid = settlement.payAndRegister(payer, assetHash, laterAnalysisHash, laterCopyScore, laterVersionHash, bytes32(0));

        assertTrue(uid != bytes32(0));
        assertEq(token.balanceOf(creator), 240); // 300 * 80 / 100
    }

    function test_reentrancyGuardBlocksPiggybackedRegistrationDuringPayment() public {
        ReentrantERC20 evilToken = new ReentrantERC20();
        bytes32 assetHash = keccak256("reentrancy-payment-target");
        bytes32 unrelatedAssetHash = keccak256("unrelated-asset-attacker-wants-for-free");

        vm.prank(owner);
        registry.authorizeCaller(address(this));
        registry.registerIfClear(assetHash, creator, 100, address(evilToken));

        // Authorized as a submitter too, so this test proves the
        // REENTRANCY guard specifically blocks the piggyback — not
        // incidentally relying on the separate authorized-submitter
        // check, which a malicious *token* contract would never pass in
        // the first place.
        vm.prank(owner);
        settlement.authorizeSubmitter(address(evilToken));

        evilToken.mint(payer, 1_000);
        vm.prank(payer);
        evilToken.approve(address(settlement), 1_000);

        evilToken.setAttack(settlement, unrelatedAssetHash);

        (, bytes32 analysisHash, uint8 copyScore, bytes32 analysisVersionHash) = _payload(assetHash, 50);

        // Without the guard, the reentrant call from evilToken's
        // transferFrom would succeed in self-registering the unrelated
        // asset for free (RoyaltySettlement, not the token, is what's
        // authorized on the registry — the reentrant call still reaches
        // registerIfClear). With the guard, that reentrant call hits
        // ReentrancyGuard's own revert, and the whole outer transaction —
        // including payer's legitimate payment — reverts too, so nothing
        // gets smuggled in.
        vm.prank(submitter);
        vm.expectRevert();
        settlement.payAndRegister(payer, assetHash, analysisHash, copyScore, analysisVersionHash, bytes32(0));

        assertEq(evilToken.balanceOf(payer), 1_000); // legitimate payment never went through either
        RightsRegistry.RightsRecord memory unrelatedRecord = registry.getAssetRights(unrelatedAssetHash);
        assertEq(unrelatedRecord.rightsHolder, address(0)); // piggybacked registration blocked
    }
}
