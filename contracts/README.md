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
