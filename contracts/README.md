# Contracts

Intentionally empty for MVP. No custom Solidity is deployed — this module
uses Soneium's existing EAS + SchemaRegistry contracts directly (see
`/src/blockchain/soneium`).

## Future: CopySightResolver.sol

If/when the project needs on-chain attester restriction, payload
validation, signer rotation, or revocation rules beyond what EAS provides
natively, that logic goes here. Not needed for the sandbox demo or the
current MVP scope — confirmed out of scope per the architect's spec and
the client's "don't overbuild it" direction. The off-chain equivalent
(attester/schema checks) already exists in
`src/core/verification/AttestationVerifier.ts`.
