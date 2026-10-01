// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { RightsRegistry } from "../RightsRegistry.sol";

contract RightsRegistryTest is Test {
    RightsRegistry registry;

    address owner = makeAddr("owner");
    address settlement = makeAddr("settlement"); // stands in for the RoyaltySettlement contract
    address creator = makeAddr("creator");
    address token = makeAddr("token");

    function setUp() public {
        vm.prank(owner);
        registry = new RightsRegistry(owner);
    }

    function test_ownerCanAuthorizeAndDeauthorizeCallers() public {
        assertFalse(registry.isAuthorizedCaller(settlement));

        vm.prank(owner);
        registry.authorizeCaller(settlement);
        assertTrue(registry.isAuthorizedCaller(settlement));

        vm.prank(owner);
        registry.deauthorizeCaller(settlement);
        assertFalse(registry.isAuthorizedCaller(settlement));

        // Not just the flag — a real call must actually be blocked.
        vm.prank(settlement);
        vm.expectRevert(abi.encodeWithSelector(RightsRegistry.UnauthorizedCaller.selector, settlement));
        registry.registerIfClear(keccak256("post-deauth-asset"), creator, 100, token);
    }

    function test_nonOwnerCannotAuthorizeCallers() public {
        vm.prank(creator);
        vm.expectRevert();
        registry.authorizeCaller(settlement);
    }

    function test_unauthorizedCallerCannotRegisterIfClear() public {
        bytes32 assetHash = keccak256("asset-1");
        vm.prank(creator); // creator is not an authorized caller — only RoyaltySettlement should be
        vm.expectRevert(abi.encodeWithSelector(RightsRegistry.UnauthorizedCaller.selector, creator));
        registry.registerIfClear(assetHash, creator, 100, token);
    }

    function test_authorizedCallerRegistersFirstTimeClearAsset() public {
        vm.prank(owner);
        registry.authorizeCaller(settlement);

        bytes32 assetHash = keccak256("asset-1");
        vm.prank(settlement);
        registry.registerIfClear(assetHash, creator, 100, token);

        RightsRegistry.RightsRecord memory record = registry.getAssetRights(assetHash);
        assertEq(record.rightsHolder, creator);
        assertEq(record.basePrice, 100);
        assertEq(record.paymentToken, token);
    }

    function test_cannotRegisterTheSameAssetTwice() public {
        vm.prank(owner);
        registry.authorizeCaller(settlement);

        bytes32 assetHash = keccak256("asset-1");
        vm.startPrank(settlement);
        registry.registerIfClear(assetHash, creator, 100, token);

        address someoneElse = makeAddr("someoneElse");
        vm.expectRevert(abi.encodeWithSelector(RightsRegistry.AlreadyRegistered.selector, assetHash));
        registry.registerIfClear(assetHash, someoneElse, 200, token);
        vm.stopPrank();
    }

    function test_ownerCanRegisterKnownIP() public {
        bytes32 ipId = keccak256("Millie Bobby Brown");
        address rightsHolder = makeAddr("rightsHolder");

        vm.prank(owner);
        registry.registerKnownIP(ipId, rightsHolder, 500, token);

        RightsRegistry.RightsRecord memory record = registry.getKnownIPRights(ipId);
        assertEq(record.rightsHolder, rightsHolder);
        assertEq(record.basePrice, 500);
        assertEq(record.paymentToken, token);
    }

    function test_nonOwnerCannotRegisterKnownIP() public {
        bytes32 ipId = keccak256("Millie Bobby Brown");
        vm.prank(creator);
        vm.expectRevert();
        registry.registerKnownIP(ipId, creator, 500, token);
    }

    function test_registerKnownIPRejectsZeroAddressRightsHolder() public {
        bytes32 ipId = keccak256("Millie Bobby Brown");
        vm.prank(owner);
        vm.expectRevert(RightsRegistry.InvalidRightsHolder.selector);
        registry.registerKnownIP(ipId, address(0), 500, token);
    }

    function test_registerKnownIPRejectsZeroIPId() public {
        address rightsHolder = makeAddr("rightsHolder");
        vm.prank(owner);
        vm.expectRevert(RightsRegistry.InvalidIPId.selector);
        registry.registerKnownIP(bytes32(0), rightsHolder, 500, token);
    }

    function test_registerKnownIPRejectsZeroPaymentTokenWithNonzeroPrice() public {
        bytes32 ipId = keccak256("Millie Bobby Brown");
        address rightsHolder = makeAddr("rightsHolder");
        vm.prank(owner);
        vm.expectRevert(RightsRegistry.InvalidPaymentToken.selector);
        registry.registerKnownIP(ipId, rightsHolder, 500, address(0));
    }

    function test_unregisteredAssetReturnsEmptyRecord() public view {
        RightsRegistry.RightsRecord memory record = registry.getAssetRights(keccak256("never-seen"));
        assertEq(record.rightsHolder, address(0));
    }

    function test_rightsHolderCanSetTerms() public {
        vm.prank(owner);
        registry.authorizeCaller(settlement);

        bytes32 assetHash = keccak256("asset-1");
        vm.prank(settlement);
        registry.registerIfClear(assetHash, creator, 0, address(0)); // registers free, no price yet

        vm.prank(creator);
        registry.setTerms(assetHash, 250, token);

        RightsRegistry.RightsRecord memory record = registry.getAssetRights(assetHash);
        assertEq(record.basePrice, 250);
        assertEq(record.paymentToken, token);
        assertEq(record.rightsHolder, creator); // unchanged — setTerms updates price/token only, not ownership
    }

    function test_nonRightsHolderCannotSetTerms() public {
        vm.prank(owner);
        registry.authorizeCaller(settlement);

        bytes32 assetHash = keccak256("asset-1");
        vm.prank(settlement);
        registry.registerIfClear(assetHash, creator, 0, address(0));

        address impostor = makeAddr("impostor");
        vm.prank(impostor);
        vm.expectRevert(abi.encodeWithSelector(RightsRegistry.NotRightsHolder.selector, assetHash, impostor));
        registry.setTerms(assetHash, 999, token);
    }

    function test_cannotSetTermsOnAnUnregisteredAsset() public {
        bytes32 assetHash = keccak256("never-registered");
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(RightsRegistry.NotRightsHolder.selector, assetHash, creator));
        registry.setTerms(assetHash, 100, token);
    }

    function test_setTermsRejectsZeroPaymentTokenWithNonzeroPrice() public {
        vm.prank(owner);
        registry.authorizeCaller(settlement);

        bytes32 assetHash = keccak256("asset-1");
        vm.prank(settlement);
        registry.registerIfClear(assetHash, creator, 0, address(0));

        vm.prank(creator);
        vm.expectRevert(RightsRegistry.InvalidPaymentToken.selector);
        registry.setTerms(assetHash, 250, address(0));
    }

    function test_setTermsAllowsZeroPaymentTokenWhenPriceIsAlsoZero() public {
        vm.prank(owner);
        registry.authorizeCaller(settlement);

        bytes32 assetHash = keccak256("asset-1");
        vm.prank(settlement);
        registry.registerIfClear(assetHash, creator, 0, address(0));

        // Explicitly clearing back to "free to reuse" must still work.
        vm.prank(creator);
        registry.setTerms(assetHash, 0, address(0));

        RightsRegistry.RightsRecord memory record = registry.getAssetRights(assetHash);
        assertEq(record.basePrice, 0);
        assertEq(record.paymentToken, address(0));
    }
}
