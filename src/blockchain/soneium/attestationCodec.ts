import { SchemaEncoder } from '@ethereum-attestation-service/eas-sdk'
import { COPYSIGHT_ANALYSIS_SCHEMA } from '../../schemas/CopySightAnalysisSchema.js'
import type { AttestationInput } from '../BlockchainAdapter.js'

/**
 * Pure encode/decode for the CopySight schema — no network, no signer,
 * fully unit-testable. Pulled out of SoneiumEASAdapter specifically so
 * this logic has real test coverage without needing a live connection
 * or even a throwaway private key (the adapter itself can't be
 * constructed at all without a funded-looking key, so anything inlined
 * there was previously untestable).
 */

export function encodeAttestationData(input: AttestationInput): string {
  const encoder = new SchemaEncoder(COPYSIGHT_ANALYSIS_SCHEMA)
  return encoder.encodeData([
    { name: 'assetHash', value: input.assetHash, type: 'bytes32' },
    { name: 'analysisHash', value: input.analysisHash, type: 'bytes32' },
    { name: 'copyScore', value: input.copyScore, type: 'uint8' },
    { name: 'analysisVersionHash', value: input.analysisVersionHash, type: 'bytes32' },
  ])
}

export function decodeAttestationData(data: string): Omit<AttestationInput, 'recipient'> {
  const encoder = new SchemaEncoder(COPYSIGHT_ANALYSIS_SCHEMA)
  const decoded = encoder.decodeData(data)
  const field = (name: string) => decoded.find((d) => d.name === name)?.value.value

  return {
    assetHash: field('assetHash') as `0x${string}`,
    analysisHash: field('analysisHash') as `0x${string}`,
    copyScore: Number(field('copyScore')),
    analysisVersionHash: field('analysisVersionHash') as `0x${string}`,
  }
}
