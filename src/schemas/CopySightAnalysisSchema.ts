/**
 * Combined schema for Proof of Creation + IP Scoring in a single
 * attestation, matching the one-pass demo flow. Deliberately minimal —
 * no detectedIP/category/ipOwner/artist/modelVersion/timestamp fields.
 */
export const COPYSIGHT_ANALYSIS_SCHEMA =
  'bytes32 assetHash, bytes32 analysisHash, uint8 copyScore, bytes32 analysisVersionHash'

export const SCHEMA_CONFIG = {
  name: 'CopySight_ipAnalysis',
  schema: COPYSIGHT_ANALYSIS_SCHEMA,
  // Non-revocable: a re-analysis supersedes a prior attestation via a new
  // one referencing it (refUID) rather than revoking it. This is why
  // CopySightResolver.sol's onRevoke() is effectively dead code.
  revocable: false,
  // Zero address until CopySightResolver.sol is deployed (see
  // scripts/deployCopySightResolver.ts and registerSoneiumSchema.ts for
  // wiring it in via COPYSIGHT_RESOLVER_ADDRESS).
  resolverAddress: '0x0000000000000000000000000000000000000000' as `0x${string}`,
}
