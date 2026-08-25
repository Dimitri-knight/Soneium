import { describe, expect, it } from 'vitest'
import { buildAttestationPayload } from '../../../src/core/attestation/AttestationBuilder.js'

const baseParams = {
  assetBytes: new TextEncoder().encode('some image bytes'),
  analysis: { copyScore: 87, detectedIps: [] },
  copyScore: 87,
  analysisVersion: 'v1.0.0',
}

describe('buildAttestationPayload', () => {
  it('produces all four expected fields', () => {
    const payload = buildAttestationPayload(baseParams)
    expect(payload.assetHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(payload.analysisHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(payload.analysisVersionHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(payload.copyScore).toBe(87)
  })

  it('is deterministic for identical input', () => {
    expect(buildAttestationPayload(baseParams)).toEqual(buildAttestationPayload(baseParams))
  })

  it('rejects a score above 100', () => {
    expect(() => buildAttestationPayload({ ...baseParams, copyScore: 101 })).toThrow()
  })

  it('rejects a negative score', () => {
    expect(() => buildAttestationPayload({ ...baseParams, copyScore: -1 })).toThrow()
  })

  it('rejects a non-integer score', () => {
    expect(() => buildAttestationPayload({ ...baseParams, copyScore: 50.5 })).toThrow()
  })

  it('passes through an optional recipient', () => {
    const recipient = '0x000000000000000000000000000000000000aa' as const
    const payload = buildAttestationPayload({ ...baseParams, recipient })
    expect(payload.recipient).toBe(recipient)
  })
})
