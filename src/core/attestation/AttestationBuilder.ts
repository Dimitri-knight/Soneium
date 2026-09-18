import { hashAnalysisVersion, hashAnalysis, type AnalysisResult } from '../analysis/AnalysisCanonicalizer.js'
import { hashAsset } from '../hashing/AssetHashingService.js'
import type { AttestationInput } from '../../blockchain/BlockchainAdapter.js'

export interface BuildAttestationPayloadParams {
  assetBytes: Uint8Array
  analysis: AnalysisResult
  copyScore: number
  analysisVersion: string
  recipient?: `0x${string}`
  /** UID of a prior attestation this one supersedes (re-analysis case). Omit for a first-time attestation. */
  refUID?: `0x${string}`
}

/**
 * Assembles the on-chain hash/score fields (+ optional recipient and refUID)
 * from raw inputs. Pure and network-free, so it's fully unit-testable.
 *
 * ABI encoding for EAS's SchemaEncoder is chain-specific and lives in
 * SoneiumEASAdapter.ts instead, to keep this module chain-agnostic.
 */
export function buildAttestationPayload(params: BuildAttestationPayloadParams): AttestationInput {
  if (!Number.isInteger(params.copyScore) || params.copyScore < 0 || params.copyScore > 100) {
    throw new Error(`copyScore must be an integer 0-100, got ${params.copyScore}`)
  }

  return {
    assetHash: hashAsset(params.assetBytes),
    analysisHash: hashAnalysis(params.analysis),
    copyScore: params.copyScore,
    analysisVersionHash: hashAnalysisVersion(params.analysisVersion),
    recipient: params.recipient,
    refUID: params.refUID,
  }
}
