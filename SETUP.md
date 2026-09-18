# Setup Status — CopySight × Soneium Integration (Minato sandbox)

Living checklist. Update as items resolve — don't let this go stale.

## Real end-to-end run against real CopySight output — biggest milestone yet

Client provided a real sandbox API key and 6 real sample videos. Ran the actual pipeline against all 6, for real, no mocks:

**real file → hash asset → call CopySight's live `/verify` API → derive copyScore → hash analysis → build the on-chain attestation payload.**

All 6 succeeded, 0 errors. Results (full detection detail in the run log, not reproduced here):

| File | copyScore | What was detected |
|---|---|---|
| AS_PR19_CS1.mp4 | 95 | Millie Bobby Brown (celebrity) |
| AS_PR19_CS2.mp4 | 98 | Christopher Lee + 3 distinct "Count Dracula" character variants attributed to *different* rights holders (Hammer Films vs. Universal) simultaneously |
| AS_PR19_CS4.mp4 | 90 | Gardens by the Bay — Cloud Forest Conservatory (brand/iconic design) |
| AS_PR19_CS5.mp4 | **0** | Nothing detected — clean asset, proves the zero-detection path for real |
| AS_PR19_CS6.mp4 | 98 | Christopher Lee, 3 Dracula/character variants, Doctor Strange |
| (biomechanical portrait sample) | 95 | Millie Bobby Brown + a real trademark (Florence by Mills logo) |

**Confirmed empirically, not from docs alone: CopySight's public API has no aggregate score field.** `demo/normalizeAnalysis.ts` derives `copyScore = round(maxSimilarity × 100)` across all `detected_ips`, defaulting to 0 when none are found — this is "Option A" from the original architecture doc, now confirmed as the real path rather than a fallback. The multi-rights-holder Dracula case (CS2/CS6) is a good real-world justification for keeping the *full* detection detail in the off-chain hashed analysis rather than just the score — the max-similarity number alone would have hidden that nuance.

New for this: `demo/` — `CopySightClient.ts` (real API wrapper), `normalizeAnalysis.ts` (raw response → copyScore + analysis, 8 tests including the real captured response as a fixture), `runFullFlow.ts` (`npm run demo:flow`). Explicitly **not** part of the production module — documented in `demo/README.md` why. `test samples/` is real third-party media (real detected likenesses) and is gitignored, not ours to redistribute.

**Where it still stops, honestly:** every payload was built successfully and is ready to submit, but actual on-chain submission still needs a funded Minato wallet and a registered `schemaUID` — neither exists yet. This run proves everything up to that boundary works with 100% real data; it doesn't move that boundary.

**One thing worth a direct answer, not a guess:** is `round(maxSimilarity × 100)` the aggregation rule that's actually wanted (worst single match, not an average or weighted combination across all detections)? It's defensible and it's what's built, but it was inferred, not confirmed.

### Closed the two gaps the real run exposed

The real run above proved the happy path end to end, but honestly exposed two untested paths: `CopySightClient`'s error handling had never hit a real error (all 6 calls returned 200), and the image-response code path had never run against real data (all 6 samples were video). Closed the first one now — the second still needed a real image sample (closed below, once one was provided).

- `test/demo/CopySightClient.test.ts` — 11 new tests, mocking `fetch` for the documented 401/422/429/500/503 shapes: status propagation, `retry_after` parsed from the body vs. the `Retry-After` header (header wins when both present), a graceful fallback when the error body itself isn't valid JSON, and the `advanced`/`sensitivity` request fields (including the `sensitivity: 0` edge case, which would silently vanish under a naive `if (options.sensitivity)` check instead of the `!== undefined` check actually used).
- `runFullFlow.ts` now prints a final tally (`N/M succeeded`, failures listed) instead of requiring someone to count console output by eye, and sets a non-zero exit code if anything failed.
- **`npm test` → 167 passing, 6 skipped**, 18 test files (up from 148/16). Foundry unaffected, still 17/17.
- Didn't re-run the live demo against real samples for this — the change is a non-functional tally addition, and burning real API calls to re-verify a cosmetic change isn't worth it. Worth a manual re-run if you want to see it, not required to trust it.

### Image path now confirmed for real too

A real sample image (`photo_2026-09-14_14-27-31.jpg`) was added to `test samples/`. Ran `demo:flow` again against all 7 samples (6 video + 1 image), real API call, no mocks: **7/7 succeeded.**

| File | copyScore | What was detected |
|---|---|---|
| photo_2026-09-14_14-27-31.jpg | 95 | Nanosuit (Crysis) — costume/character match |

**Confirmed empirically, not assumed:** the image response shape differs from video — `detected_ips` comes back as an **array** of `{name, category, similarity, ...}` objects for images, vs. an **object keyed by name** for video. `normalizeAnalysis.ts` already handled both shapes correctly on the first real run — no fix needed, this just closes the "never actually exercised" gap noted above.

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

## Second milestone: CopySightResolver.sol — CONFIRMED for adoption

Built directly off the production-milestone diagram Architect shared. **Both decisions below are now resolved: the overall decision to actually adopt a custom resolver (confirmed — "copysight resolver contract is confirmed to develop according to the architecture") and the `revocable` flag (confirmed `false`).** What follows was a verified, ready-to-review draft at the time it was written; see the later "Thorough audit pass" and the resolved items under "Still pending" for current status.

Compiled and tested against **real, locally-deployed SchemaRegistry + EAS contracts** (not mocks).

- `contracts/CopySightResolver.sol` — implements exactly the 4 responsibilities from the diagram: authorized-attesters-only, payload validation, CopyScore 0-100 validation, revocation validation. Signer rotation via owner-controlled `authorizeAttester()`/`deauthorizeAttester()` (supports multiple attesters, not just one).
- `contracts/test/CopySightResolver.t.sol` — **13/13 Foundry tests passing**, `forge build` clean.
- `foundry.toml` — src=`contracts`, test=`contracts/test`, remappings into `node_modules` for `@ethereum-attestation-service/eas-contracts` and `@openzeppelin/contracts` (kept consistent with npm as the dependency source of truth, same as the TS side).
- New dependencies: `@openzeppelin/contracts` (v5.6.1, for `Ownable` — verified its v5 constructor needs an explicit `initialOwner`, not assumed), `forge-std` (installed as a git submodule via `forge install`, not committed).

**Important discovery, verified against EAS's actual `EAS.sol` source, not assumed:** EAS's core `_revoke()` already enforces "only the original attester may revoke their own attestation" *before* our resolver's `onRevoke()` ever runs — and it's structurally impossible to revoke an attestation issued under a schema registered `revocable: false` in the first place. This means `onRevoke()` is **only reachable at all if the schema's `revocable` flag is `true`.** **Resolved:** Architect confirmed `revocable` stays `false` — corrections happen via a new attestation referencing the old one (`refUID`), not revocation. `onRevoke()` is confirmed dead code by design, kept as a zero-cost switch to flip later if real revocation is ever needed.

**Side effects worth knowing about, not something I did directly:** `forge install foundry-rs/forge-std` staged `.gitmodules` and `lib/forge-std` via `git submodule add` (a standard, unavoidable part of how git submodules work) — staged, not committed. Separately, `forge build`/`forge install` auto-appended `cache/` and `contracts/out/` to `.gitignore` on its own, which is expected Foundry behavior and correct (build artifacts shouldn't be tracked).

## Revocation / supersession flow (Phase 2 item 6)

Architect confirmed the registries and AccessControl stay deferred (conditions for each spelled out, none met yet), and sharpened item 6 into something buildable now. Built and tested:

- `AttestationInput`/`AttestationRecord` — added `refUID` (EAS's own native field, not part of our custom schema data — nothing added to `CopySightAnalysisSchema.ts`).
- `TransactionStatus` — added `REVOKED`, documented as distinct from the submission-lifecycle statuses (a later discovery, not an immediate outcome).
- `SoneiumEASAdapter` — passes `refUID` through to `eas.attest()` (defaulting to the verified real `ZERO_BYTES32` constant when omitted), returns it from `getAttestation()`.
- `BlockchainProofService.supersedeBlockchainProof(assetId, previousAssetId, params)` — new method for the re-analysis case. Looks up the previous asset's confirmed `attestationUID` and uses it as the new attestation's `refUID` automatically, so callers don't have to fetch and pass it manually. Reuses `createBlockchainProof` entirely.
- `AttestationVerifier.verifyNotRevoked(uid)` — the missing explicit check from Phase 2 item 7, separated from the other checks so a caller can distinguish "doesn't exist" from "existed but was revoked."
- `npm test` → **41 passing, 6 skipped** (up from 37/6). Foundry suite unaffected, still 13/13.

## Production-readiness pass — closing the "draft" gaps

Went through every deliberately-minimal piece flagged earlier and either finished it or gave an honest reason it's still open. `npx tsc --noEmit` clean, **`npm test` → 54 passing, 6 skipped** (up from 41), Foundry still 13/13, `verify:setup` still passing live against Minato after the config restructure.

- **Idempotency actually wired in, not just computed.** `BlockchainProofService.createBlockchainProof()` now checks `findByIdempotencyKey` before submitting — a repeat request for the same (tenant, asset, analysis version, schema) returns the existing proof instead of attesting again. Previously the key was computed and unit-tested in isolation but nothing called it.
- **`SignerService`** (`src/blockchain/signing/SignerService.ts`) — new abstraction. `EnvSignerService` reads per-environment env vars and wraps every signer in ethers' own `NonceManager` (verified it exists in the installed package before using it — this satisfies "nonce management" without hand-rolling it). Returns the abstract `Signer` type, not concretely `Wallet`, specifically so a future KMS-backed Mainnet implementation is a drop-in swap, not a rewrite.
- **`SoneiumEASAdapter` refactored** to accept an injected `Signer` in its constructor instead of reading `COPYSIGHT_ATTESTER_PRIVATE_KEY` and constructing its own `Wallet` directly. This is what actually makes signer rotation / secure key storage possible at the application layer — the adapter no longer knows or cares how the key is held.
- **Failed-transaction recovery, via reconciliation, not blind resubmission.** `TransactionManager.recoverStuckAttestation()` — when `waitForConfirmation` times out (PENDING rather than a definitive answer), checks whether the attestation actually landed before assuming failure. Deliberately does *not* attempt a same-nonce gas-bumped replacement transaction — that's a real technique but risky to ship untested against a live network; reconciliation-first avoids the actual danger (double-attesting) with much lower risk.
- **Environment separation** — `config.ts` restructured into per-environment (`minato`/`mainnet`) config via `getEnvironmentConfig()`, with a `config` export kept as a Minato-defaulting alias for full backward compatibility. Mainnet chain (1868), RPC, schema UID, attester address/key, and resolver address all have their own env vars now — none of it wired to actually deploy or attest on Mainnet automatically.
- **Resolver deployment script** (`scripts/deployCopySightResolver.ts`, `npm run deploy:resolver`) — verified Foundry's actual compiled artifact JSON shape (`abi`, `bytecode.object`) against a real build output before writing this, not assumed.
- **Attester rotation admin script** (`scripts/manageAttester.ts`, `npm run manage:attester <authorize|deauthorize> <address>`) — calls the resolver's owner-only functions directly.
- **`registerSoneiumSchema.ts` updated** to use the injected-signer pattern and pass a real resolver address when `COPYSIGHT_RESOLVER_ADDRESS` is set (still zero-address if not — now an explicit choice logged at runtime, not a silent default).
- **`.env.example`** — added `COPYSIGHT_RESOLVER_ADDRESS` and the full Mainnet env-var set, each commented with why it's separate from the Minato equivalent.

**Still genuinely open, not finished this round:**
- ~~Deeper monitoring: RPC-error-specific logging, signer activity logging, real alerting integration.~~ **Closed below** ("Deeper monitoring/logging"), except real alerting integration — deliberately still deferred, see that section.
- `deployCopySightResolver.ts` and `manageAttester.ts` are written against the real artifact shape and typecheck clean, but like the rest of the live-network path, **not yet run against a real funded wallet.**

## Real Postgres-backed persistence (closes "Blockchain Sync" storage)

Checked first whether a local Postgres or running Docker daemon was available to test against live — neither was (no local install, Docker Desktop installed but its daemon isn't running). Built the same way as the blockchain side in that situation: production-shaped, verified everywhere it's possible to verify without a live connection, honestly flagged where it isn't.

- `PostgresBlockchainProofStore` (`src/services/PostgresBlockchainProofStore.ts`) — implements `BlockchainProofStore` for real, using the plain `pg` driver and hand-written SQL. No ORM: one table, three query shapes, consistent with this project's pattern of not adding a framework where a small amount of direct code does the job (same call as the hand-written logger instead of pino/winston).
- Verified `pg`'s actual `Pool.query<T>()` and `QueryResult.rows` types against the installed package before writing against them, not assumed.
- `migrations/001_blockchain_proofs.sql` — the schema, plus `npm run migrate:db` to apply it (simple sequential `.sql` file runner in a transaction; no migration framework brought in for one file).
- Row↔`BlockchainProof` mapping is unit-tested against a **mocked** `Pool` — 6 tests covering the INSERT/ON CONFLICT parameter order, null handling, and the BIGINT-comes-back-as-a-string-from-pg case specifically (a real, easy-to-get-wrong detail, caught by a dedicated test).
- `DATABASE_URL` added to `.env.example`. `InMemoryBlockchainProofStore` stays the default in code until this is configured and verified — nothing switches automatically.

## Real Postgres, for real this time — closes the last honest gap

Docker Desktop's daemon wasn't running when the above was originally built (checked, not assumed). Checked again later — this time `Start-Service com.docker.service` actually brought it up (`docker ps` responded), so there was no reason left to leave this unverified.

- Started a real, throwaway `postgres:16-alpine` container, ran `npm run migrate:db` against it for real (not against a mock) — applied cleanly.
- Exercised `PostgresBlockchainProofStore` directly against it: a real `INSERT`, a real `SELECT`, a real repeat-save through the `ON CONFLICT`/`UPDATE` path, `findByStatus`, and — the specific case the mocked tests were written to guard against — a real BIGINT `timestamp` column, confirmed to round-trip back as an actual JS `number`, not the string `pg` returns by default. All passed, no SQL errors, no mapping bugs.
- **Turned into a permanent, repeatable test**, same pattern as the anvil devnet one: `test/integration/postgresDevnet.test.ts` (own `vitest.postgres.config.ts`, own `npm run test:postgres`) — spins up a fresh throwaway container, migrates it, runs 5 real assertions against it, tears the container down. **5/5 passing.** Deliberately excluded from default `npm test` (needs a real `docker` daemon) — still 177 passing, 6 skipped, unaffected.
- Updated `PostgresBlockchainProofStore`'s class doc to drop the "not yet run against a real Postgres instance" caveat — it has been, twice now (once by hand, once as a standing test).

**What's left here is purely operational, not a code gap:** pointing `DATABASE_URL` at whatever Postgres instance production actually uses. Nothing about the store's code needs to change for that.

**One real bug found and fixed in this same pass, unrelated to Postgres:** the new `SignerService` tests were intermittently timing out — not a hang, a cold `tsx` transform of the `ethers`/`viem` import graph genuinely takes ~4.2s (measured directly, not guessed), right at the edge of vitest's 5000ms default. Fixed with an explicit 15s timeout on those specific tests rather than either ignoring the flakiness or raising the timeout globally (which would mask a real hang elsewhere if one ever occurs).

`npm test` → **60 passing, 6 skipped** (up from 54). Foundry still 13/13.

## Thorough audit pass — real bugs found, not just cleanup

Ran a structured audit across all five areas of the codebase (core logic, blockchain adapter layer, services/persistence, the Solidity contract, and the CLI scripts): each area audited independently, every finding adversarially re-verified against the actual code before anything was touched, then fixed with new tests. Every fix was self-checked in isolation, and everything was re-verified centrally afterward — `npx tsc --noEmit` clean, **`npm test` → 148 passing, 6 skipped** across 16 test files (up from 60/9), **Foundry → 17/17 passing, and independently confirmed 100% line/statement/branch/function coverage on `CopySightResolver.sol`** (not just repeated from a self-report — checked with `forge coverage`).

This surfaced real functional bugs, not just tidying:

- **A `__proto__` key silently corrupted canonicalization.** `AnalysisCanonicalizer`'s key-sorting used a plain object accumulator — assigning to a key literally named `__proto__` doesn't create a normal property, it reassigns the object's prototype, silently dropping that field from the hash entirely. Fixed with `Object.create(null)`.
- **Different analysis payloads could hash identically.** Dates, `Map`/`Set`, and non-finite numbers (`NaN`/`Infinity`) were being silently canonicalized to `'{}'`/`'null'` instead of rejected — meaning materially different inputs could collide to the same hash. Now throws instead of silently coercing.
- **`waitForConfirmation`'s timeout handling was dead code.** Verified against ethers v6's actual source: `waitForTransaction` with a timeout never resolves `null` — it *rejects* with a `TIMEOUT` error. The old `if (!receipt) return 'PENDING'` could never fire; a real timeout would have thrown an uncaught exception instead of degrading gracefully to `PENDING`. Now catches specifically the `TIMEOUT` case and rethrows anything else.
- **The nonce-management fix from the last pass wasn't actually effective.** `SignerService` was constructing a *new* `NonceManager` (independent in-memory nonce state) on every `getSigner()` call instead of reusing one — meaning concurrent submissions could still collide on nonces, exactly what wrapping in `NonceManager` was supposed to prevent. Now caches and returns the same instance per environment.
- **The idempotency fix from two passes ago had its own bug.** A deduped second request returned the *first* proof's object, including its original `assetId` — so looking the proof up under the *second* (requested) `assetId` would fail to find anything. Also: two truly concurrent identical requests could both slip past the idempotency check and attest on-chain twice, since the check-then-act wasn't atomic. Both fixed — an in-process mutex now serializes concurrent identical requests, and the deduped result is aliased under the newly requested `assetId` too.
- **`attester` on a `BlockchainProof` was never actually populated**, even after confirmation, despite the field existing. Now backfilled from the real on-chain attester once `CONFIRMED`.
- **A store-write failure after a successful on-chain attestation was mislabeled `FAILED`** — the single try/catch didn't distinguish "the chain call failed" from "saving the result failed," so a real success could be recorded as a failure. Split into narrower try/catches.
- **`verifyMinatoSetup.ts` never actually asserted anything** — despite being called a "sanity check," it only printed values for a human to eyeball and always exited 0. Now fails loudly (exit 1) on a wrong chain ID or missing contract bytecode.
- **`registerSoneiumSchema.ts` and `deployCopySightResolver.ts` had no guard against re-running** — re-registering or redeploying would have either failed with a confusing on-chain revert or silently orphaned a schemaUID/resolver pairing. Both now refuse with a clear message unless explicitly forced.
- Malformed attestation payloads, invalid address/UID-shaped env vars, and a few stale docstrings/comments (referencing removed behavior, or predating `CopySightResolver.sol`'s existence) were also caught and fixed.

Every script's `main()` also ran unconditionally at import time, which meant the newly-extracted, newly-testable pure logic inside each one couldn't be imported by a test without triggering a live RPC/DB call. All five scripts now guard `main()` behind an "is this actually being run directly" check.

**One explicit loose end the contracts-area work flagged for me directly, fixed centrally:** `@ethereum-attestation-service/eas-contracts` (which `CopySightResolver.sol` imports from directly) was only ever an indirect, transitive dependency via `eas-sdk` — never pinned explicitly in `package.json`. A future `eas-sdk` update could have silently changed or dropped it out from under the Solidity build. Added as an explicit direct dependency, pinned to the installed `1.7.1`.

Left untouched, correctly: every deliberate "pending Architect decision" flag (`revocable`, the resolver-adoption decision, the three open design questions below) and every "not yet run against a live network/DB" caveat — none of these were placeholders to clean up, and none were touched.

## Open design questions surfaced while building — low-priority, confirm with Architect whenever convenient

Deprioritized: these are deliberate calls made while building, not bugs or blockers — confident they're correct as-is, so getting a formal one-line confirmation from the Architect can wait rather than being chased down now.

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

## Local dry run against a real anvil chain — real bug found and fixed (would have blocked real Minato use too)

Motivation: the Minato faucet is still the one hard blocker on the live-network path, but nothing stops proving the *rest* of the pipeline for real without it. Spun up a local `anvil` chain (Foundry's own, already installed), deployed fresh `SchemaRegistry` + `EAS` contracts to it (same source as the real predeploys), then ran the actual project scripts — completely unmodified — against it by pointing the usual env vars (`SONEIUM_RPC_URL`, `SONEIUM_SCHEMA_REGISTRY_ADDRESS`, `SONEIUM_EAS_ADDRESS`, `COPYSIGHT_ATTESTER_PRIVATE_KEY`, ...) at the local chain instead of Minato. No source changes were needed to make this possible — everything was already environment-variable-driven.

**This immediately surfaced a real bug that has nothing to do with the faucet — it would have hit on real Minato too, the very first time `register:schema` or a real attestation was actually run:**

- `npm run register:schema` crashed instantly: `SyntaxError: The requested module '@ethereum-attestation-service/eas-sdk' does not provide an export named 'SchemaEncoder'`.
- Root cause, confirmed directly (not guessed): the installed `@ethereum-attestation-service/eas-sdk@2.9.1` has no `"type": "module"` in its own `package.json`. That's not an oversight to patch away — it's a real necessity on their end, since their own ESM build re-exports named imports from CJS-only `lodash`, which would break under real Node ESM otherwise (confirmed by testing — adding `"type":"module"` to the installed package "fixes" the `SchemaEncoder` error but immediately breaks on `lodash`'s `isEqual` instead).
- The actual consequence: **`vitest`** (Vite's own module resolution) and **`tsx`/plain Node** (the real native ESM loader, used by every `npm run register:schema` / `deploy:resolver` / real script) resolve this one package *differently*. Vitest's named imports work fine but there's no `default` export. Node's native loader treats the package as CommonJS (because of the missing `type` field) and its static named-export detection misses some exports entirely (`SchemaEncoder` specifically) — but it always still provides the whole CJS `module.exports` as `default`, regardless of what it detected.
- **This was invisible until now because every existing test mocked the EAS SDK entirely** — this local dry run was the first time any of `SoneiumEASAdapter.ts`/`attestationCodec.ts`'s real, unmocked code had ever actually executed.
- **Fix**: `src/blockchain/soneium/easSdkInterop.ts` (new, small, documented) — a namespace import (`import * as ns from '...'`) works under both runtimes; prefer `ns.default` when present (the Node/tsx case), fall back to the namespace itself otherwise (the vitest case). `attestationCodec.ts` and `SoneiumEASAdapter.ts` now both go through this instead of a plain named import. The two `vi.doMock('@ethereum-attestation-service/eas-sdk', ...)` factories (`attestationCodec.test.ts`, `SoneiumAttestation.e2e.test.ts`) were updated to expose the same shape both at the top level and under `default:`, matching the real interop shape — this is what makes the mocks work under both import styles too.
- Re-verified after the fix: `npx tsc --noEmit` clean, **`npm test` → still 167 passing, 6 skipped** (no regression), Foundry still 17/17.

**With that real bug fixed, ran the actual production path end to end for the first time, against the local chain, using a real sample file (`photo_2026-09-14_14-27-31.jpg`) — no mocks anywhere in this list:**

1. `deploy:resolver` — deployed `CopySightResolver.sol` for real via `ContractFactory`.
2. `register:schema` — registered the real `CopySight_ipAnalysis` schema, `revocable: false`, with that resolver attached. Got back a real `schemaUID`.
3. `SoneiumEASAdapter.createAttestation()` — submitted a real attestation from the authorized attester account. Real transaction hash, real `waitForConfirmation()` → `CONFIRMED`.
4. `SoneiumEASAdapter.getAttestation()` — read it back; every field (assetHash, analysisHash, copyScore, analysisVersionHash, attester, revoked) matched exactly what was submitted.
5. `SoneiumEASAdapter.verifyAttestation()` → `true`. `AttestationVerifier`'s four application-level checks (`verifySchema`, `verifyAttester`, `verifyAsset`, `verifyNotRevoked`) → all `true`.
6. **Resolver enforcement, proven live, not just in Foundry tests:** an attestation attempt from an unauthorized signer reverted correctly. A `copyScore: 150` attempt (over the 0-100 range) reverted correctly.

This is about as close to "real Minato" as it's possible to get without a funded wallet — same contracts, same scripts, same adapter code, same signer/nonce path, real transactions, real confirmations, real resolver-level reverts. The local anvil chain, its deployed contracts, and `deployments/minato.json`'s local-chain record were all torn down afterward (nothing from this dry run persists) so nothing here gets confused with an actual Minato deployment later. When the faucet tokens do arrive, this is now a confirmed-working path, not an untested one.

### Turned into a permanent, repeatable test — `npm run test:devnet`

The manual dry run above was one-off and caught a real bug purely by chance (by actually being run). Rather than leave that as a one-time proof, it's now `test/integration/localAnvilDevnet.test.ts` — a real, unmocked vitest integration test that automates the exact same steps: spins up `anvil`, deploys fresh `SchemaRegistry`/`EAS`/`CopySightResolver`, registers the real schema, submits a real attestation, confirms it, reads it back, verifies it (adapter- and application-level), and proves both resolver enforcement rules (unauthorized attester, out-of-range copyScore) live. **4/4 passing.**

- Deliberately **excluded from the default `npm test`** (new `vitest.config.ts` excludes `test/integration/**`) — it shells out to real `anvil`/`forge` binaries and does real local transactions, so it's slower and has an external-tool dependency the fast/hermetic default suite (167 passing, 6 skipped, unaffected) doesn't need.
- Run explicitly via `npm run test:devnet` (its own `vitest.devnet.config.ts`, since the default config's exclude would otherwise also block it).
- Value going forward: this class of bug — anything only visible when the real SDK actually talks to a real chain, as opposed to a mocked one — now gets caught automatically, on demand, without ever needing a funded Minato wallet. Worth running after any change that touches `SoneiumEASAdapter.ts`, `attestationCodec.ts`, or `CopySightResolver.sol`.

**Testnet tryout itself deprioritized for now** (per direct steer, not a technical blocker) — the above is the intended substitute until/unless real Minato access becomes a priority again.

## Deeper monitoring/logging — closes a "still genuinely open" item

Picked up the "Deeper monitoring" gap flagged after the production-readiness pass (RPC-error-specific logging, signer activity logging). Both fully buildable with no live network/DB needed, so no reason to leave them open while waiting on the faucet.

- **`src/core/logging/errorClassification.ts`** (new) — `classifyError()` normalizes any thrown value into a structured `{ kind, message, reason?, data? }` using ethers' own real, verified `ErrorCode` union (`CALL_EXCEPTION`, `NETWORK_ERROR`, `TIMEOUT`, `INSUFFICIENT_FUNDS`, `NONCE_EXPIRED`, ...), not a raw `err.message` string. `CALL_EXCEPTION` (an on-chain revert — e.g. `CopySightResolver` rejecting an unauthorized attester or an out-of-range copyScore) gets its `reason`/`data` extracted too, which is what actually shows *why* a revert happened in the logs instead of a generic "execution reverted". Anything without a real ethers `.code` (our own thrown `Error`s, e.g. a store failure) is classified `UNKNOWN` rather than misreported as a network/chain issue. 6 new tests.
- **Wired into `BlockchainProofService`**'s `markFailed()` and the attester-backfill-failure log — both now log `{ kind, message, reason?, data? }` instead of a bare message string.
- **Real functional fix, not just a log-message improvement**: `TransactionManager.withRetry()` previously retried *every* error blindly, including permanent ones — a `CopySightResolver` rejection (unauthorized attester, invalid copyScore) would get retried 2-3 times with exponential backoff before finally failing, uselessly, since the exact same call reverts identically every time. Now uses `classifyError()` to retry only genuine transient kinds (`NETWORK_ERROR`, `SERVER_ERROR`, `TIMEOUT`, plus `UNKNOWN` as a conservative default matching the function's original behavior for non-ethers errors) and rethrows immediately otherwise. 3 new tests, including one proving a plain non-ethers `Error` still retries exactly as before (no regression).
- **Signer activity logging** — `EnvSignerService.getSigner()` now logs `signer_service.signer_constructed` (environment, address, rpcUrl) once per environment, on the actual construction (cache-miss) path only — not on every call, so a real operator can see which wallet is active for which environment without a log line per attestation. 1 new test asserting it fires once on first call and not again on a cached repeat.
- Re-verified: `npx tsc --noEmit` clean, **`npm test` → 177 passing, 6 skipped** (up from 167 — 10 new tests across the three areas above), Foundry still 17/17, `test:devnet` still 4/4 (and now fails its two negative-path assertions faster, since permanent reverts no longer get retried first).
- **Real alerting integration stays deliberately deferred** — there's no actual alerting service (PagerDuty, Slack webhook, etc.) configured or authorized to integrate with, and building a fake one would be pure "don't overbuild it" territory. The structured JSON logs (now with real error classification) are the natural hook point for whatever real system gets wired in later — nothing here needs to change to support that.

## Still pending — blocked on someone else

- [x] **Schema content sign-off from Architect** — confirmed: the minimal 4-field schema (in `CopySightAnalysisSchema.ts`) is the real one, matching the Architect's Phase 2 production diagram. `npm run register:schema` is still not run — that's now blocked purely on the Minato faucet below, not on this decision.
- [x] `revocable` flag — confirmed `false` by Architect (see "Second milestone" above).
- [x] Resolver adoption — confirmed: build and use `CopySightResolver.sol` (see "Second milestone" above). Not yet deployed, blocked on the Minato faucet below.
- [x] CopySight sandbox API credentials + sample test assets — received (live API key + real sample videos in `test samples/`); see the demo-run results further down.
- [ ] Minato faucet — still not found/received, needed to fund the attester wallet before `register:schema`, `deploy:resolver`, or any real attestation/deployment can run. This is now the single remaining blocker for the whole live-network path.
- [ ] `SoneiumEASAdapter.ts` is written against the SDK's documented API but **has not been run against a live network yet** — needs the funded wallet above before it can actually be exercised and trusted.

## Explicitly deferred — not this milestone

- Mainnet config (chain ID 1868)
- Custom `CopySightResolver.sol` (folder reserved at `/contracts`, stays empty)
- KMS/HSM signer, multisig
- Account abstraction / paymaster / gas sponsorship
- Audit tooling
