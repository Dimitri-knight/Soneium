import { afterEach, describe, expect, it, vi } from 'vitest'
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

  it('throws a clear error on truncated/malformed data rather than silently returning garbage fields', () => {
    // Byte blob far too short for the 4-field schema; the EAS SDK's ABI
    // decoder throws on the length mismatch before this module's own
    // code runs.
    const truncated = '0x1111111111111111111111111111111111111111111111111111111111111111'
    expect(() => decodeAttestationData(truncated)).toThrow()
  })
})

describe('decodeAttestationData — missing named field (mocked SDK)', () => {
  afterEach(() => {
    vi.doUnmock('@ethereum-attestation-service/eas-sdk')
    vi.resetModules()
  })

  /**
   * The real EAS SDK always returns one entry per schema field — a
   * malformed blob throws during ABI decoding rather than producing a
   * field-missing array. The SDK is mocked here so decodeAttestationData's
   * field-presence guard actually gets exercised.
   */
  it('throws a clear, field-naming error when the decoded payload is missing an expected field', async () => {
    // Reset the module registry before mocking — attestationCodec.js is
    // already cached from this file's top-level import, so otherwise the
    // dynamic import below would resolve to the un-mocked instance.
    vi.resetModules()
    vi.doMock('@ethereum-attestation-service/eas-sdk', () => {
      // The source consumes this via a default import + destructure, so
      // the mock exposes the fields both at the top level and under
      // `default`, matching the real package's CJS interop shape.
      const mocked = {
        SchemaEncoder: class {
          constructor(_schema: string) {}
          encodeData() {
            throw new Error('not used in this test')
          }
          decodeData() {
            // copyScore is absent — simulates a stale-schema payload
            // decoded against the current CopySight schema.
            return [
              {
                name: 'assetHash',
                type: 'bytes32',
                value: { name: 'assetHash', type: 'bytes32', value: `0x${'11'.repeat(32)}` },
              },
              {
                name: 'analysisHash',
                type: 'bytes32',
                value: { name: 'analysisHash', type: 'bytes32', value: `0x${'22'.repeat(32)}` },
              },
              {
                name: 'analysisVersionHash',
                type: 'bytes32',
                value: { name: 'analysisVersionHash', type: 'bytes32', value: `0x${'33'.repeat(32)}` },
              },
            ]
          }
        },
      }
      return { ...mocked, default: mocked }
    })

    const { decodeAttestationData: decodeWithMockedSDK } = await import(
      '../../../src/blockchain/soneium/attestationCodec.js'
    )
    expect(() => decodeWithMockedSDK('0xdeadbeef')).toThrow(/copyScore/)
  })
})
