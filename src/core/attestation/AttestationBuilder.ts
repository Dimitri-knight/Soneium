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
 * Assembles the four on-chain fields (+ optional recipient) from raw
 * inputs. This is the seam between "pure hashing/canonicalization" and
 * "talk to the blockchain" — nothing here touches the network, so it's
 * fully unit-testable.
 *
 * NOTE on scope vs. the architect's spec: the spec also names an
 * `encodeAttestationData()` function on this module. ABI-style encoding
 * is inherently EAS-specific (Solidity type encoding via SchemaEncoder),
 * so it's implemented in SoneiumEASAdapter.ts instead — keeping this
 * file chain-agnostic. Worth confirming with Architect that's the
 * intended split, rather than assuming.
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
