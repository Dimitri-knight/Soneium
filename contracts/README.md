# Contracts

This module uses Soneium's existing EAS + SchemaRegistry contracts directly
(see `/src/blockchain/soneium`). A custom resolver contract also lives
here — see below.

## CopySightResolver.sol

Implements attester restriction, payload validation, CopyScore 0-100
validation, and revocation rules on top of EAS's own `SchemaResolver`, per
the architect's production-milestone diagram. Signer rotation is
owner-controlled add/remove of authorized attesters (supports more than
one at a time).

- `contracts/test/CopySightResolver.t.sol` — 17/17 Foundry tests passing
  (`forge test`), `forge build` clean, `forge coverage` shows 100%
  line/branch/function coverage.
- Referenced by `scripts/deployCopySightResolver.ts` and
  `scripts/manageAttester.ts` (deployment/admin), and by docs/SETUP.md's
  "Second milestone" section.
- Adopted as the real resolver, not EAS's bare `SchemaRegistry`.
  `CopySightAnalysisSchema.ts`'s `revocable` flag is `false`, matching the
  "immutable proof" framing — corrections happen via a new attestation
  referencing the old one (`refUID`), not revocation. That makes this
  contract's `onRevoke()` dead code today, kept as a zero-cost switch to
  flip later if real revocation is ever needed.
- Not yet deployed — blocked on Minato faucet funds, same as the rest of
  the live-network path. `scripts/deployCopySightResolver.ts` is ready to
  run as soon as a funded wallet exists. Until then, the off-chain
  equivalent (attester/schema checks) in
  `src/core/verification/AttestationVerifier.ts` is what's exercised in
  tests.

## RightsRegistry.sol

Tracks who should be paid a royalty when a later submission matches an
asset. Two mappings, keyed differently on purpose:

- `assetRights` (keyed by `assetHash`) — a creator's own previously
  self-registered original.
- `knownIPRights` (keyed by an admin-assigned IP id) — a known external
  IP (a celebrity, a brand). A new infringing-looking upload never
  shares an `assetHash` with the IP it resembles, so it can't be keyed
  the same way as a self-registered original.

`registerIfClear()` is restricted to authorized callers only (via
`authorizeCaller()`/`deauthorizeCaller()`, owner-controlled) — in
practice, only `RoyaltySettlement`, so nobody can claim an asset's
rights directly without going through a real payment/attestation flow.
`setTerms()` lets the current rights holder set or change their price
and payment token any time after registering — deliberately a separate
step from registration itself, since a creator may not know their price
yet, or may want reuse to stay free. `registerKnownIP()` is owner-only,
since populating real external-IP rights-holder data depends on a
rights-verification process this contract has no way to perform itself.

Both `setTerms()` and `registerKnownIP()` reject `paymentToken =
address(0)` alongside a nonzero price — a real footgun found in review:
without this check, a rights holder (or the owner, for a known IP) could
accidentally set a price with no token to pay it in, permanently
blocking every future match on that asset until someone noticed and
fixed it. `registerKnownIP()` also rejects `ipId = bytes32(0)`, since
that value is the universal "no known-IP match" sentinel everywhere
else — an entry registered there could never actually be looked up.

- `contracts/test/RightsRegistry.t.sol` — 16/16 Foundry tests passing.

## RoyaltySettlement.sol

Pays a royalty, then attests, in one transaction — the blockchain record
must not exist unless the required payment succeeded.
`payAndRegister()` looks up `RightsRegistry` itself (never trusts a
caller-supplied price), resolves to one of three cases (an existing
self-registered holder, a known external IP, or a first-time clean
asset with no payment due), pulls payment via OpenZeppelin's
`SafeERC20.safeTransferFrom` when one is owed, and only then calls
`eas.attest()`. A payer who is already the registered rights holder for
that asset is never charged, regardless of score — re-checking your own
work never costs you anything.

**Registered as an authorized attester on the existing
`CopySightResolver` via its already-existing `authorizeAttester()`** —
same mechanism as any signer key, so the resolver itself needed zero
code changes. `attestation.attester` for a royalty-gated submission is
simply `RoyaltySettlement`'s own contract address.

**`payAndRegister` is restricted to owner-authorized submitters** (via
`authorizeSubmitter()`/`deauthorizeSubmitter()`, mirroring
`RightsRegistry`'s own `authorizeCaller()` pattern) **— it is not open to
arbitrary callers.** A real, severe gap found in a pre-production
security review: since this contract is itself a resolver-authorized
attester, an unrestricted `payAndRegister()` meant anyone could call it
directly with a fabricated `copyScore`/`analysisHash` and get a real,
resolver-accepted "CopySight-verified" attestation with no actual
analysis behind it, or squat an unclaimed `assetHash` for free. Fixed by
restricting the caller to the same trusted backend key already used
everywhere else in this system, and by taking the real payer as an
**explicit parameter** (`payAndRegister(address payer, ...)`) rather than
`msg.sender` — so the trusted backend can submit on a real end user's
behalf (same "backend submits, user never needs gas or to sign the
submission tx" model as every other attestation) while the ERC-20 pull
is still correctly attributed to that user's own wallet. The payer still
has to `approve()` this contract from their own wallet beforehand — the
one step only the token owner can do.

**A real reentrancy vulnerability, found and fixed, not theorized.**
`payAndRegister()` is `nonReentrant` because the payment token is
attacker-choosable (whoever registers or sets terms on an asset picks
it). Verified directly: `msg.sender` for a reentrant call from inside
`transferFrom` is the token contract itself, not the real payer, so a
malicious token can't double-charge the payer directly — but since
`RightsRegistry` authorizes this contract (not the token), an
unreentered call could still reach `registerIfClear` and self-register
an entirely unrelated, unclaimed asset for free, riding on someone
else's real payment transaction. Confirmed both ways: the exploit
visibly succeeds with the guard temporarily removed, and the whole
transaction correctly reverts with it restored.

- `contracts/test/RoyaltySettlement.t.sol` — 13/13 Foundry tests passing,
  including the reentrancy exploit proven both ways
  (`test_reentrancyGuardBlocksPiggybackedRegistrationDuringPayment`), the
  new authorized-submitter restriction
  (`test_unauthorizedSubmitterCannotCallPayAndRegister`), and the
  self-payment exemption at a nonzero score
  (`test_rightsHolderNeverPaysThemselvesEvenAtNonZeroCopyScore`).
- Combined with `RightsRegistry.t.sol` and `CopySightResolver.t.sol`,
  **`forge test` → 46/46 passing**, all three contracts independently
  confirmed at 100% line/statement/branch/function coverage via `forge
  coverage`.
- Referenced by `scripts/deployRoyaltyContracts.ts` (`npm run
  deploy:royalty`, which also authorizes the existing backend attester
  key as the one trusted submitter) and
  `src/blockchain/soneium/SoneiumEASAdapter.ts`'s
  `createAttestationWithRoyalty()`.
- Proven against real infrastructure (not just Foundry unit tests) in
  `test/integration/localAnvilDevnet.test.ts` — a real `MockERC20`
  royalty payment with correct payer attribution, the
  insufficient-approval failure case, an unauthorized wallet's direct
  call being rejected live, and the self-payment exemption, all against
  a real anvil chain. **`npm run test:devnet` → 9/9 passing.** See
  `docs/SETUP.md`'s "Royalty feature" and "Production-readiness pass"
  sections for the full writeup. The four open questions originally
  flagged there (payment token, known-IP registry population process,
  wallet-signing, frontend ownership) are all now confirmed resolved —
  each matches what was already built, so none required a code change.
