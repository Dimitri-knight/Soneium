import type { AnalysisResult } from '../analysis/AnalysisCanonicalizer.js'
import { hashAnalysis } from '../analysis/AnalysisCanonicalizer.js'
import { hashAsset } from '../hashing/AssetHashingService.js'
import type { BlockchainAdapter } from '../../blockchain/BlockchainAdapter.js'

/**
 * Checks that a blockchain proof belongs to CopySight and matches the
 * asset/result it claims to describe. A read-only complement to the
 * on-chain CopySightResolver's attester enforcement — see
 * SoneiumEASAdapter.verifyAttestation() for the lower-level version.
 *
 * Depends only on BlockchainAdapter, so it's testable with a fake adapter.
 */
export class AttestationVerifier {
  constructor(
    private readonly adapter: BlockchainAdapter,
    private readonly expectedSchemaUID: `0x${string}`,
    /** One attester, several (e.g. the plain backend key and a royalty-settlement contract address — both are legitimate sources for the same schema), or omitted to skip this check entirely. */
    private readonly expectedAttesters?: `0x${string}` | ReadonlyArray<`0x${string}`>
  ) {}

  async verifySchema(uid: `0x${string}`): Promise<boolean> {
    const record = await this.adapter.getAttestation(uid)
    return record?.schemaUID === this.expectedSchemaUID
  }

  async verifyAttester(uid: `0x${string}`): Promise<boolean> {
    const record = await this.adapter.getAttestation(uid)
    if (!record) return false
    // An empty array must behave like "not configured", not like "no address can ever match" —
    // [] is truthy in JS, so this can't just be `if (!this.expectedAttesters)`.
    const allowlist = !this.expectedAttesters
      ? []
      : Array.isArray(this.expectedAttesters)
        ? this.expectedAttesters
        : [this.expectedAttesters]
    if (allowlist.length === 0) return true // no allowlist configured — nothing to check against
    return allowlist.some((attester) => record.attester.toLowerCase() === attester.toLowerCase())
  }

  /** Confirms these exact file bytes match the assetHash recorded in this attestation. */
  async verifyAsset(uid: `0x${string}`, assetBytes: Uint8Array): Promise<boolean> {
    const record = await this.adapter.getAttestation(uid)
    if (!record) return false
    return record.data.assetHash === hashAsset(assetBytes)
  }

  /** Confirms this exact analysis result matches the analysisHash recorded in this attestation. */
  async verifyAnalysis(uid: `0x${string}`, analysis: AnalysisResult): Promise<boolean> {
    const record = await this.adapter.getAttestation(uid)
    if (!record) return false
    return record.data.analysisHash === hashAnalysis(analysis)
  }

  /** Separate from the other checks so callers can distinguish "doesn't exist" from "revoked". */
  async verifyNotRevoked(uid: `0x${string}`): Promise<boolean> {
    const record = await this.adapter.getAttestation(uid)
    if (!record) return false
    return !record.revoked
  }
}
