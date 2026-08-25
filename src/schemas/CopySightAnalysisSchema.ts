/**
 * Single combined schema for MVP — Proof of Creation + IP Scoring in one
 * attestation, matching the client's actual demo flow (one pass, not two).
 *
 * IMPORTANT: this is the MINIMAL version from the architect's code spec,
 * NOT the richer diagram box (which additionally listed detectedIP/
 * category/ipOwner/artist/modelVersion/timestamp as public strings).
 * Still needs explicit sign-off from Architect that this minimal version
 * is the real one — schema registration is effectively one-way, so do
 * not run scripts/registerSoneiumSchema.ts until that's confirmed.
 */
export const COPYSIGHT_ANALYSIS_SCHEMA =
  'bytes32 assetHash, bytes32 analysisHash, uint8 copyScore, bytes32 analysisVersionHash'

export const SCHEMA_CONFIG = {
  name: 'CopySight_ipAnalysis',
  schema: COPYSIGHT_ANALYSIS_SCHEMA,
  // PENDING CONFIRMATION — defaulting to non-revocable, matching the
  // "immutable proof" framing already used publicly. If a re-analysis
  // needs to supersede a prior attestation, that should happen via a new
  // attestation referencing the old one (refUID), not by revoking.
  revocable: false,
  // No custom resolver for MVP — confirmed out of scope.
  resolverAddress: '0x0000000000000000000000000000000000000000' as `0x${string}`,
}
