import type { AnalysisResult } from '../analysis/AnalysisCanonicalizer.js'
import { hashAnalysis } from '../analysis/AnalysisCanonicalizer.js'
import { hashAsset } from '../hashing/AssetHashingService.js'
import type { BlockchainAdapter } from '../../blockchain/BlockchainAdapter.js'

/**
 * Confirms a blockchain proof really belongs to CopySight and matches
 * the asset/result it claims to describe. This is the application-level
 * check that replaces a custom resolver contract for MVP — see
 * SoneiumEASAdapter.verifyAttestation() for the lower-level version this
 * builds on.
 *
 * Depends only on BlockchainAdapter (chain-agnostic), so it's fully
 * testable with a fake adapter — no live network needed.
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
}
