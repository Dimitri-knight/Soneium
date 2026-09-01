import { describe, expect, it } from 'vitest'
import { sha256, stringToBytes } from 'viem'
import {
  decodeAttestationData,
  encodeAttestationData,
} from '../../../src/blockchain/soneium/attestationCodec.js'
import type { AttestationInput } from '../../../src/blockchain/BlockchainAdapter.js'

const sample: AttestationInput = {
  assetHash: sha256(stringToBytes('sample asset')),
  analysisHash: sha256(stringToBytes('sample analysis')),
  copyScore: 73,
  analysisVersionHash: sha256(stringToBytes('v1.0.0')),
}

describe('attestationCodec — real EAS SDK encoding, no network needed', () => {
  it('round-trips: decode(encode(x)) equals x', () => {
    const encoded = encodeAttestationData(sample)
    const decoded = decodeAttestationData(encoded)
    expect(decoded).toEqual(sample)
  })

  it('is deterministic for identical input', () => {
    expect(encodeAttestationData(sample)).toBe(encodeAttestationData(sample))
  })

  it('produces valid hex-encoded bytes', () => {
    expect(encodeAttestationData(sample)).toMatch(/^0x[0-9a-f]+$/)
  })

  it('encodes to exactly 128 bytes (4 static fields x 32-byte ABI words) — CopySightResolver.sol hardcodes this length to validate payloads on-chain, so this test guards against silent drift', () => {
    const encoded = encodeAttestationData(sample)
    const byteLength = (encoded.length - 2) / 2
    expect(byteLength).toBe(128)
  })

  it('round-trips the copyScore boundary value 0', () => {
    const encoded = encodeAttestationData({ ...sample, copyScore: 0 })
    expect(decodeAttestationData(encoded).copyScore).toBe(0)
  })

  it('round-trips the copyScore boundary value 100', () => {
    const encoded = encodeAttestationData({ ...sample, copyScore: 100 })
    expect(decodeAttestationData(encoded).copyScore).toBe(100)
  })
})
