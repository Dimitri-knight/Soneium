// Namespace import + resolveEasSdkModule instead of a named import —
// see easSdkInterop.ts for why.
import * as EasSdkNs from '@ethereum-attestation-service/eas-sdk'
import { resolveEasSdkModule } from './easSdkInterop.js'
import { COPYSIGHT_ANALYSIS_SCHEMA } from '../../schemas/CopySightAnalysisSchema.js'
import type { AttestationInput } from '../BlockchainAdapter.js'

const { SchemaEncoder } = resolveEasSdkModule(EasSdkNs)

/**
 * Pure encode/decode for the CopySight schema — no network or signer
 * involved, so it's unit-testable without a live connection.
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

/** The four fields the CopySight schema always encodes — see COPYSIGHT_ANALYSIS_SCHEMA. */
const REQUIRED_FIELDS = ['assetHash', 'analysisHash', 'copyScore', 'analysisVersionHash'] as const

export function decodeAttestationData(data: string): Omit<AttestationInput, 'recipient'> {
  const encoder = new SchemaEncoder(COPYSIGHT_ANALYSIS_SCHEMA)
  const decoded = encoder.decodeData(data)
  const field = (name: string) => decoded.find((d) => d.name === name)?.value.value

  // Guard against a malformed payload (wrong schema version, a
  // corrupted data blob) silently producing garbage — `Number(undefined)`
  // is NaN, and a missing hash field would otherwise be cast straight to
  // `0x${string}` as `undefined`.
  for (const name of REQUIRED_FIELDS) {
    if (field(name) === undefined) {
      throw new Error(
        `Malformed attestation data: expected field "${name}" is missing. ` +
          'This payload does not match the CopySight schema (bytes32 assetHash, bytes32 analysisHash, uint8 copyScore, bytes32 analysisVersionHash).'
      )
    }
  }

  return {
    assetHash: field('assetHash') as `0x${string}`,
    analysisHash: field('analysisHash') as `0x${string}`,
    copyScore: Number(field('copyScore')),
    analysisVersionHash: field('analysisVersionHash') as `0x${string}`,
  }
}
