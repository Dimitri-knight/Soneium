// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { SchemaRegistry } from "@ethereum-attestation-service/eas-contracts/contracts/SchemaRegistry.sol";
import { ISchemaRegistry } from "@ethereum-attestation-service/eas-contracts/contracts/ISchemaRegistry.sol";
import { EAS } from "@ethereum-attestation-service/eas-contracts/contracts/EAS.sol";
import {
    AttestationRequest,
    AttestationRequestData,
    RevocationRequest,
    RevocationRequestData
} from "@ethereum-attestation-service/eas-contracts/contracts/IEAS.sol";
import { EMPTY_UID, NO_EXPIRATION_TIME } from "@ethereum-attestation-service/eas-contracts/contracts/Common.sol";
import { CopySightResolver } from "../CopySightResolver.sol";

/// @notice Deploys real SchemaRegistry + EAS instances locally (not
/// mocks) so this exercises the actual on-chain flow our resolver will
/// run under, not an approximation of it.
contract CopySightResolverTest is Test {
    SchemaRegistry registry;
    EAS eas;
    CopySightResolver resolver;

    address owner = makeAddr("owner");
    address authorizedAttester = makeAddr("authorizedAttester");
    address unauthorizedAttester = makeAddr("unauthorizedAttester");

    bytes32 schemaUID;

    string constant SCHEMA = "bytes32 assetHash, bytes32 analysisHash, uint8 copyScore, bytes32 analysisVersionHash";

    function setUp() public {
        registry = new SchemaRegistry();
        eas = new EAS(ISchemaRegistry(address(registry)));
        resolver = new CopySightResolver(eas, authorizedAttester, owner);

        // Registered revocable=true here specifically to exercise
        // onRevoke() below — this is the resolver's own test suite
        // proving its full capability, independent of the real
        // production schema, which is registered revocable=false
        // (confirmed — see CopySightResolver.sol's contract-level note).
        schemaUID = registry.register(SCHEMA, resolver, true);
    }

    function _validPayload(uint8 copyScore) internal pure returns (bytes memory) {
        return abi.encode(bytes32(uint256(1)), bytes32(uint256(2)), copyScore, bytes32(uint256(3)));
    }

    function _attestAs(address attester, bytes memory data) internal returns (bytes32) {
        vm.prank(attester);
        return
            eas.attest(
                AttestationRequest({
                    schema: schemaUID,
                    data: AttestationRequestData({
                        recipient: address(0),
                        expirationTime: NO_EXPIRATION_TIME,
                        revocable: true,
                        refUID: EMPTY_UID,
                        data: data,
                        value: 0
                    })
                })
            );
    }

    // --- onAttest: authorized attesters only ---

    function test_authorizedAttesterCanAttest() public {
        bytes32 uid = _attestAs(authorizedAttester, _validPayload(87));
        assertTrue(uid != EMPTY_UID);
    }

    function test_unauthorizedAttesterReverts() public {
        vm.expectRevert(abi.encodeWithSelector(CopySightResolver.UnauthorizedAttester.selector, unauthorizedAttester));
        _attestAs(unauthorizedAttester, _validPayload(50));
    }

    // --- onAttest: payload validation ---

    function test_wrongPayloadLengthReverts() public {
        bytes memory badData = abi.encode(bytes32(uint256(1))); // 32 bytes, not the expected 128
        vm.expectRevert(abi.encodeWithSelector(CopySightResolver.InvalidPayloadLength.selector, badData.length));
        _attestAs(authorizedAttester, badData);
    }

    function test_overlongPayloadReverts() public {
        // 160 bytes (5 words) — the other direction a payload can be the
        // wrong length, vs. test_wrongPayloadLengthReverts' too-short case.
        bytes memory badData = abi.encode(
            bytes32(uint256(1)),
            bytes32(uint256(2)),
            uint8(50),
            bytes32(uint256(3)),
            bytes32(uint256(4))
        );
        vm.expectRevert(abi.encodeWithSelector(CopySightResolver.InvalidPayloadLength.selector, badData.length));
        _attestAs(authorizedAttester, badData);
    }

    // --- onAttest: copyScore 0-100 validation ---

    function test_copyScoreAbove100Reverts() public {
        vm.expectRevert(abi.encodeWithSelector(CopySightResolver.InvalidCopyScore.selector, 101));
        _attestAs(authorizedAttester, _validPayload(101));
    }

    function test_copyScoreBoundary0Succeeds() public {
        bytes32 uid = _attestAs(authorizedAttester, _validPayload(0));
        assertTrue(uid != EMPTY_UID);
    }

    function test_copyScoreBoundary100Succeeds() public {
        bytes32 uid = _attestAs(authorizedAttester, _validPayload(100));
        assertTrue(uid != EMPTY_UID);
    }

    // --- signer rotation ---

    function test_constructorEmitsAttesterAuthorizedForInitialAttester() public {
        address freshAttester = makeAddr("freshAttester");

        vm.expectEmit(true, false, false, false);
        emit CopySightResolver.AttesterAuthorized(freshAttester);
        new CopySightResolver(eas, freshAttester, owner);
    }

    function test_ownerCanAuthorizeNewAttester() public {
        address newAttester = makeAddr("newAttester");
        assertFalse(resolver.isAuthorizedAttester(newAttester));

        vm.expectEmit(true, false, false, false, address(resolver));
        emit CopySightResolver.AttesterAuthorized(newAttester);
        vm.prank(owner);
        resolver.authorizeAttester(newAttester);

        assertTrue(resolver.isAuthorizedAttester(newAttester));
        bytes32 uid = _attestAs(newAttester, _validPayload(60));
        assertTrue(uid != EMPTY_UID);
    }

    function test_ownerCanDeauthorizeAttester() public {
        vm.expectEmit(true, false, false, false, address(resolver));
        emit CopySightResolver.AttesterDeauthorized(authorizedAttester);
        vm.prank(owner);
        resolver.deauthorizeAttester(authorizedAttester);

        vm.expectRevert(abi.encodeWithSelector(CopySightResolver.UnauthorizedAttester.selector, authorizedAttester));
        _attestAs(authorizedAttester, _validPayload(50));
    }

    function test_deauthorizedAttesterCanBeReauthorizedAndAttestAndRevokeAgain() public {
        // Full rotate-out/rotate-back-in cycle — not just "deauthorize
        // blocks" and "authorize enables" tested in isolation.
        vm.prank(owner);
        resolver.deauthorizeAttester(authorizedAttester);

        vm.expectRevert(abi.encodeWithSelector(CopySightResolver.UnauthorizedAttester.selector, authorizedAttester));
        _attestAs(authorizedAttester, _validPayload(40));

        vm.expectEmit(true, false, false, false, address(resolver));
        emit CopySightResolver.AttesterAuthorized(authorizedAttester);
        vm.prank(owner);
        resolver.authorizeAttester(authorizedAttester);

        bytes32 uid = _attestAs(authorizedAttester, _validPayload(65));
        assertTrue(uid != EMPTY_UID);

        vm.prank(authorizedAttester);
        eas.revoke(RevocationRequest({ schema: schemaUID, data: RevocationRequestData({ uid: uid, value: 0 }) }));
    }

    function test_authorizingZeroAddressIsAHarmlessNoOpByDesign() public {
        // No zero-address guard exists in _setAuthorized. This documents
        // that as an accepted no-op by design, not an oversight: a real
        // attest()/revoke() call's msg.sender can never be address(0), so
        // isAuthorizedAttester[address(0)] being set true has no
        // exploitable effect.
        assertFalse(resolver.isAuthorizedAttester(address(0)));

        vm.prank(owner);
        resolver.authorizeAttester(address(0));
        assertTrue(resolver.isAuthorizedAttester(address(0)));

        vm.prank(owner);
        resolver.deauthorizeAttester(address(0));
        assertFalse(resolver.isAuthorizedAttester(address(0)));
    }

    function test_nonOwnerCannotAuthorizeAttester() public {
        vm.prank(unauthorizedAttester);
        vm.expectRevert(); // OpenZeppelin's own Ownable error, not one of ours
        resolver.authorizeAttester(unauthorizedAttester);
    }

    function test_nonOwnerCannotDeauthorizeAttester() public {
        vm.prank(unauthorizedAttester);
        vm.expectRevert();
        resolver.deauthorizeAttester(authorizedAttester);
    }

    // --- onRevoke: revocation validation ---

    function test_authorizedAttesterCanRevokeTheirOwnAttestation() public {
        bytes32 uid = _attestAs(authorizedAttester, _validPayload(75));

        vm.prank(authorizedAttester);
        eas.revoke(RevocationRequest({ schema: schemaUID, data: RevocationRequestData({ uid: uid, value: 0 }) }));
    }

    function test_nonAttesterCannotRevokeSomeoneElsesAttestation() public {
        bytes32 uid = _attestAs(authorizedAttester, _validPayload(75));

        address newAttester = makeAddr("newAttester");
        vm.prank(owner);
        resolver.authorizeAttester(newAttester);

        // EAS core itself enforces "only the original attester" before
        // our resolver's onRevoke ever runs — this proves that baseline
        // protection is real, not just assumed from reading the source.
        vm.prank(newAttester);
        vm.expectRevert();
        eas.revoke(RevocationRequest({ schema: schemaUID, data: RevocationRequestData({ uid: uid, value: 0 }) }));
    }

    function test_deauthorizedAttesterCannotRevokeTheirOwnOldAttestation() public {
        bytes32 uid = _attestAs(authorizedAttester, _validPayload(75));

        vm.prank(owner);
        resolver.deauthorizeAttester(authorizedAttester);

        // This is the resolver's own added rule on top of EAS's
        // baseline check — rotating an attester out also freezes their
        // ability to revoke old records with that same key.
        vm.prank(authorizedAttester);
        vm.expectRevert(abi.encodeWithSelector(CopySightResolver.AttesterNoLongerAuthorized.selector, authorizedAttester));
        eas.revoke(RevocationRequest({ schema: schemaUID, data: RevocationRequestData({ uid: uid, value: 0 }) }));
    }
}
