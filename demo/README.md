# Demo — real CopySight API, real sample media

**Not part of the production integration module.** The real CopySight × Soneium module (`src/`) is called *in-process* by CopySight's own backend after *its own* analysis runs — it never calls CopySight's public API itself (see `BlockchainProofService`, which takes an already-computed `analysis` object as input, not a file to send anywhere).

This folder exists purely to drive an end-to-end demo using **real CopySight output** against the actual `/v1/verify` API, instead of synthetic test fixtures — for showing the pipeline works, not for production use.

## What's here

- `CopySightClient.ts` — thin wrapper around CopySight's real, documented `/verify` endpoint.
- `normalizeAnalysis.ts` — maps a real CopySight response into `{ copyScore, analysis }`. **Important:** CopySight's public API has no aggregate "CopyScore" field — confirmed via a real live call, not just the docs. This derives one as `round(maxSimilarity * 100)` across all detections. That's a reasonable default, not a confirmed product decision — flag it if the real aggregation rule should be something else.
- `runFullFlow.ts` (`npm run demo:flow`) — runs the real pipeline against every file in `/test samples`: hash asset → call CopySight → normalize → hash analysis → build the attestation payload. **Stops there on purpose** — actual on-chain submission needs a funded Minato wallet and a registered schema, neither of which exist yet.

## Sample media

`/test samples` is gitignored — real sample video containing an actual detected celebrity likeness has no business being committed to source control, and it's several MB besides. Ask whoever provided it if you need it again.
