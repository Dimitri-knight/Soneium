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
    private readonly expectedAttester?: `0x${string}`
  ) {}

  async verifySchema(uid: `0x${string}`): Promise<boolean> {
    const record = await this.adapter.getAttestation(uid)
    return record?.schemaUID === this.expectedSchemaUID
  }

  async verifyAttester(uid: `0x${string}`): Promise<boolean> {
    const record = await this.adapter.getAttestation(uid)
    if (!record) return false
    if (!this.expectedAttester) return true // no allowlist configured — nothing to check against
    return record.attester.toLowerCase() === this.expectedAttester.toLowerCase()
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
