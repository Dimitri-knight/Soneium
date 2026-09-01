# Setup Status — CopySight × Soneium Integration (Minato sandbox)

Living checklist. Update as items resolve — don't let this go stale.

## Repo structure (matches architect's spec)

```
/src
  /core
    /hashing         AssetHashingService.ts        ✅ built, tested
    /analysis        AnalysisCanonicalizer.ts       ✅ built, tested
    /attestation     AttestationBuilder.ts          ✅ built, tested
    /verification    AttestationVerifier.ts         ✅ built, tested
  /blockchain
    BlockchainAdapter.ts                            ✅ interface written
    /soneium
      config.ts                                     ✅ built, verified live
      attestationCodec.ts                           ✅ built, tested (real EAS SDK encode/decode round-trip)
      SoneiumEASAdapter.ts                           ✅ written, typechecked, NOT yet run live
    /transactions    TransactionManager.ts          ✅ built, tested (narrower scope — see note below)
  /services          BlockchainProofService.ts      ✅ built, tested
  /schemas           CopySightAnalysisSchema.ts      ✅ written, PENDING sign-off
  /models            BlockchainProof.ts             ✅ built
/scripts
  registerSoneiumSchema.ts                          ✅ written, NOT yet run — now also writes deployments/minato.json on success
  verifyMinatoSetup.ts                              ✅ built, passing
/contracts
  README.md                                         ✅ documents intentionally-empty-for-MVP + future CopySightResolver.sol
/test                                                ✅ 35/35 passing, 6 correctly auto-skipped (E2E)
```

## Verified working, end to end (as of this session)

- [x] `npx tsc --noEmit` → clean, zero errors across the whole project
- [x] `npm test` → **35 passing, 6 skipped** across 8 test files (hashing, canonicalization, attestation building, verification, service orchestration, idempotency/retry, schema encode/decode, and a live-Minato E2E suite that skips itself until config is complete)
- [x] `npm run verify:setup` → connected to Minato, chainId=1946, **SchemaRegistry and EAS contracts confirmed to have real deployed bytecode** at the expected predeploy addresses (not just assumed)
- [x] Env vars renamed to the `SONEIUM_*`/`COPYSIGHT_*` convention from the architect's spec
- [x] `BlockchainProofService`, `AttestationVerifier`, and `TransactionManager` are all designed with injectable dependencies (adapter/store as constructor params) specifically so they're testable without a live network
- [x] **`attestationCodec.ts` extracted out of the adapter** so encode/decode has real coverage against the actual EAS SDK — not mocked. `test/blockchain/soneium/attestationCodec.test.ts` proves the schema string round-trips correctly through the real `SchemaEncoder`, including 0 and 100 boundary values. This was previously untestable because `SoneiumEASAdapter` can't even be constructed without a private key.
- [x] `test/e2e/SoneiumAttestation.e2e.test.ts` written — full live-network suite (create, confirm, retrieve, verify, and an honest test documenting that EAS does *not* dedupe identical input on its own). Uses `describe.skipIf()` gated on `COPYSIGHT_ATTESTER_PRIVATE_KEY` + `COPYSIGHT_SCHEMA_UID` — currently skips cleanly, activates itself with zero code changes once both are set.

## Hardening pass (this session, no blockers needed)

- **Fixed a real bug**: `BlockchainProofService.createBlockchainProof()` had no error handling — if `adapter.createAttestation()` threw (RPC error, reverted tx), the stored proof was left stuck at `PENDING` forever instead of reflecting failure. Now wrapped in try/catch, marks the record `FAILED` and rethrows. Covered by a new test (`test/services/BlockchainProofService.test.ts`).
- **Added an explicit timeout** to `SoneiumEASAdapter.waitForConfirmation()` (60s, verified against ethers' actual `Provider.waitForTransaction` type signature) — without it, a slow/stuck RPC could hang indefinitely instead of resolving to `PENDING`.
- **Added a minimal structured logger** (`src/core/logging/logger.ts`, no external dependency) and wired it into `BlockchainProofService`'s state transitions — matches the "Monitoring & Logging" shared service from the architecture diagram without pulling in a full logging framework for an MVP this size.
- `npm test` → **36 passing, 6 skipped** (up from 35/6).

## Second milestone: CopySightResolver.sol — DRAFT, decision still in process

Built directly off the production-milestone diagram Architect shared. **Status correction: the overall decision to actually adopt a custom resolver — not just the `revocable` flag detail — is still being worked out, not finalized.** Treat everything below as a verified, ready-to-review draft, not a locked-in piece of the architecture. "Tested" here means the code correctly does what it claims, not that the approach itself is confirmed.

Compiled and tested against **real, locally-deployed SchemaRegistry + EAS contracts** (not mocks).

- `contracts/CopySightResolver.sol` — implements exactly the 4 responsibilities from the diagram: authorized-attesters-only, payload validation, CopyScore 0-100 validation, revocation validation. Signer rotation via owner-controlled `authorizeAttester()`/`deauthorizeAttester()` (supports multiple attesters, not just one).
- `contracts/test/CopySightResolver.t.sol` — **13/13 Foundry tests passing**, `forge build` clean.
- `foundry.toml` — src=`contracts`, test=`contracts/test`, remappings into `node_modules` for `@ethereum-attestation-service/eas-contracts` and `@openzeppelin/contracts` (kept consistent with npm as the dependency source of truth, same as the TS side).
- New dependencies: `@openzeppelin/contracts` (v5.6.1, for `Ownable` — verified its v5 constructor needs an explicit `initialOwner`, not assumed), `forge-std` (installed as a git submodule via `forge install`, not committed).

**Important discovery, verified against EAS's actual `EAS.sol` source, not assumed:** EAS's core `_revoke()` already enforces "only the original attester may revoke their own attestation" *before* our resolver's `onRevoke()` ever runs — and it's structurally impossible to revoke an attestation issued under a schema registered `revocable: false` in the first place. This means `onRevoke()` is **only reachable at all if the schema's `revocable` flag is `true`** — which is currently defaulted to `false` in `CopySightAnalysisSchema.ts`. That open question now has a concrete consequence either way: if `false` stands, this whole code path is dead (fine); if the production design wants real revocation, `revocable` needs to flip to `true` and this is where the added rule (deauthorized attesters can't revoke their old records either) lives. Needs Architect's call.

**Side effects worth knowing about, not something I did directly:** `forge install foundry-rs/forge-std` staged `.gitmodules` and `lib/forge-std` via `git submodule add` (a standard, unavoidable part of how git submodules work) — staged, not committed. Separately, `forge build`/`forge install` auto-appended `cache/` and `contracts/out/` to `.gitignore` on its own, which is expected Foundry behavior and correct (build artifacts shouldn't be tracked).

## Revocation / supersession flow (Phase 2 item 6)

Architect confirmed the registries and AccessControl stay deferred (conditions for each spelled out, none met yet), and sharpened item 6 into something buildable now. Built and tested:

- `AttestationInput`/`AttestationRecord` — added `refUID` (EAS's own native field, not part of our custom schema data — nothing added to `CopySightAnalysisSchema.ts`).
- `TransactionStatus` — added `REVOKED`, documented as distinct from the submission-lifecycle statuses (a later discovery, not an immediate outcome).
- `SoneiumEASAdapter` — passes `refUID` through to `eas.attest()` (defaulting to the verified real `ZERO_BYTES32` constant when omitted), returns it from `getAttestation()`.
- `BlockchainProofService.supersedeBlockchainProof(assetId, previousAssetId, params)` — new method for the re-analysis case. Looks up the previous asset's confirmed `attestationUID` and uses it as the new attestation's `refUID` automatically, so callers don't have to fetch and pass it manually. Reuses `createBlockchainProof` entirely.
- `AttestationVerifier.verifyNotRevoked(uid)` — the missing explicit check from Phase 2 item 7, separated from the other checks so a caller can distinguish "doesn't exist" from "existed but was revoked."
- `npm test` → **41 passing, 6 skipped** (up from 37/6). Foundry suite unaffected, still 13/13.

## Open design questions surfaced while building — flag to Architect

1. **`createBlockchainProof()` blocks until CONFIRMED** rather than returning PENDING immediately and updating status later via a background job/webhook. Simplicity choice for now — revisit if the demo needs non-blocking UX.
2. **`TransactionManager` scope narrowed** to idempotency-key computation + retry/backoff only. The spec's status-tracking responsibilities (PENDING/SUBMITTED/CONFIRMED/FAILED, transactionHash, attestationUID) already live in `BlockchainProofService` per-asset — giving both modules that job would mean two places tracking the same state. Confirm this split is intended.
3. **`AttestationBuilder` doesn't include `encodeAttestationData()`** as its own function, since ABI encoding is EAS-specific and lives in `SoneiumEASAdapter.ts` instead, keeping the builder chain-agnostic. Worth a one-line confirmation this is the intended split.

## Dependency notes worth remembering

- `@ethereum-attestation-service/eas-sdk` requires an **ethers.js Signer**, not viem, for its write path (`attest`, `register`) — confirmed against the actual installed package (v2.9.1), not assumed. `ethers` is now a direct dependency, scoped to `SoneiumEASAdapter.ts` only; viem stays the general-purpose client everywhere else.
- Both `vitest` and `typescript`'s latest majors failed to even run on local Node `v20.3.0` (see below) — worth remembering before blindly bumping either dependency later.

## Known issues — fixed

- `vitest`'s latest version pulled in `vite@8`/`rolldown`, which needs Node `^20.19.0 || >=22.12.0` and failed to start (`styleText` not exported from `node:util`). **Fixed by pinning `vitest@^2.1.9`.**
- `typescript@^7.0.2`'s `tsc` bin also failed to launch on this Node version (`ERR_UNKNOWN_FILE_EXTENSION`, TS7 being the new Go-based rewrite with different distribution mechanics). **Fixed by pinning `typescript@^5.7.2`.**
- Neither is a real problem, just a reminder this Node version (`v20.3.0`) is behind what the newest tooling assumes. Revisit only if there's an actual reason to upgrade Node — not needed for this project.

## Still pending — blocked on someone else

- [ ] **Schema content sign-off from Architect** — minimal 4-field schema (in `CopySightAnalysisSchema.ts`) vs. the diagram's richer version (with `ipOwner`/`artist`/`category`/`detectedIP` as public strings). Do not run `npm run register:schema` until this is confirmed — registration is effectively one-way.
- [ ] `revocable` flag — currently defaulted to `false` (non-revocable) pending explicit confirmation.
- [ ] Minato faucet — still not found in public docs, needed to fund the attester wallet before `register:schema` or any real attestation can run.
- [ ] CopySight sandbox API credentials + sample test assets.
- [ ] `SoneiumEASAdapter.ts` is written against the SDK's documented API but **has not been run against a live network yet** — needs the funded wallet above before it can actually be exercised and trusted.

## Explicitly deferred — not this milestone

- Mainnet config (chain ID 1868)
- Custom `CopySightResolver.sol` (folder reserved at `/contracts`, stays empty)
- KMS/HSM signer, multisig
- Account abstraction / paymaster / gas sponsorship
- Audit tooling
