# Contracts

This module uses Soneium's existing EAS + SchemaRegistry contracts directly
(see `/src/blockchain/soneium`). A custom resolver contract also lives
here — see below — confirmed for adoption, not yet deployed.

## CopySightResolver.sol — status: confirmed for adoption, not yet deployed

`contracts/CopySightResolver.sol` implements attester restriction, payload
validation, CopyScore 0-100 validation, and revocation rules on top of
EAS's own `SchemaResolver`, per the architect's production-milestone
diagram. Signer rotation is owner-controlled add/remove of authorized
attesters (supports more than one at a time).

- **Fully implemented and fully tested**: `contracts/test/CopySightResolver.t.sol`
  — 17/17 Foundry tests passing (`forge test`), `forge build` clean, and
  `forge coverage` shows 100% line/branch/function coverage.
- Referenced by `scripts/deployCopySightResolver.ts` and
  `scripts/manageAttester.ts` (deployment/admin), and by SETUP.md's
  "Second milestone" section.
- **Both decisions the Architect owned are now resolved**: (a) yes, use
  this custom resolver rather than EAS's bare `SchemaRegistry` (confirmed
  — this contract is real, scoped work); (b) `CopySightAnalysisSchema.ts`'s
  `revocable` flag is confirmed `false`, matching the "immutable proof"
  framing — corrections happen via a new attestation referencing the old
  one (`refUID`), not revocation. That makes this contract's `onRevoke()`
  confirmed dead code by design, kept only as a zero-cost switch to flip
  later if real revocation is ever needed. Not yet deployed only because
  it's blocked on the Minato faucet, same as the rest of the live-network
  path — `scripts/deployCopySightResolver.ts` is ready to run as soon as
  a funded wallet exists. The off-chain equivalent (attester/schema
  checks) already exists in `src/core/verification/AttestationVerifier.ts`
  and is what's exercised in tests today, ahead of the on-chain resolver
  actually being deployed.
