# Demo — real CopySight API, real sample media

**Not part of the production integration module.** The real CopySight × Soneium module (`src/`) is called *in-process* by CopySight's own backend after *its own* analysis runs — it never calls CopySight's public API itself (see `BlockchainProofService`, which takes an already-computed `analysis` object as input, not a file to send anywhere).

This folder exists purely to drive an end-to-end demo using **real CopySight output** against the actual `/v1/verify` API, instead of synthetic test fixtures — for showing the pipeline works, not for production use.

## What's here

- `CopySightClient.ts` — thin wrapper around CopySight's real, documented `/verify` endpoint.
- `normalizeAnalysis.ts` — maps a real CopySight response into `{ copyScore, analysis }`. CopySight's public API has no aggregate "CopyScore" field, so this derives one as `round(maxSimilarity * 100)` across all detections. That's a reasonable default, not a settled product decision — worth confirming if the real aggregation rule should be something else.
- `runFullFlow.ts` (`npm run demo:flow`) — runs the real pipeline against every file in `/test samples`: hash asset → call CopySight → normalize → hash analysis → build the attestation payload. **Stops there on purpose** — actual on-chain submission needs a funded Minato wallet and a registered schema, neither of which exist yet.

- `web/index.html` + `webServer.ts` (`npm run demo:web`) — a simple single-page demo UI: upload a file, analyze it with CopySight, record the result on Soneium, then verify it back. Plain HTML/JS and a bare `node:http` server, no framework — this goes one step further than `runFullFlow.ts` since it actually submits and reads back a real attestation (needs a funded wallet + registered schema, same requirement as everywhere else in this project). Also exposes the royalty flow via a checkbox (submits through `RoyaltySettlement` instead of calling EAS directly). Talks to whichever network the usual `SONEIUM_*`/`COPYSIGHT_*` env vars point at — Minato by default, or a manually-run local anvil devnet for a live demo (same env var overrides as `test/integration/localAnvilDevnet.test.ts`).
  - `payAndRegister` now requires the real payer as an explicit address (see `contracts/README.md`'s `RoyaltySettlement.sol` section) — the demo defaults it to its own single configured signer, optionally overridable via a `payerAddress` field in the `/api/attest` request body. This demo has one trusted local operator and one signer acting as both submitter and (by default) payer — it does not model multiple real end-user wallets each approving and paying separately.

## Sample media

`/test samples` is gitignored — real sample video containing an actual detected celebrity likeness has no business being committed to source control, and it's several MB besides. Ask whoever provided it if you need it again.
