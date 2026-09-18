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
    // Real, no mocking: a byte blob far too short for the 4-field
    // schema. The underlying EAS SDK ABI-decodes positionally and
    // throws on a length mismatch before this module's own code even
    // runs — asserting on that here documents that malformed input
    // fails loudly rather than the caller getting NaN/undefined fields.
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
   * The real EAS SDK's SchemaEncoder.decodeData() always returns one
   * entry per field of the schema it was constructed with (see
   * node_modules/@ethereum-attestation-service/eas-sdk's
   * schema-encoder.js) — a byte blob too short/long to match just
   * throws during ABI decoding rather than yielding a decoded array
   * missing one named entry. So the "a named field is simply absent
   * from the decoded array" case that decodeAttestationData's own
   * field-presence guard defends against can't be reproduced with the
   * real SDK — it's mocked here so that guard is still actually
   * exercised rather than left as untested defensive code.
   */
  it('throws a clear, field-naming error when the decoded payload is missing an expected field', async () => {
    // Must reset the module registry BEFORE mocking — attestationCodec.js
    // (and its eas-sdk import) is already cached from this file's static
    // top-level import, so without this the dynamic import below would
    // resolve to that same cached, un-mocked instance.
    vi.resetModules()
    vi.doMock('@ethereum-attestation-service/eas-sdk', () => {
      // Shaped to match the real package's actual CJS-interop shape (see
      // the note at the top of attestationCodec.ts): the source consumes
      // this via a default import + destructure, not named imports, so
      // the mock must expose the same fields both at the top level AND
      // under `default` — real Node gives both for a CJS module.
      const mocked = {
        SchemaEncoder: class {
          constructor(_schema: string) {}
          encodeData() {
            throw new Error('not used in this test')
          }
          decodeData() {
            // "copyScore" is entirely absent — simulates a foreign/stale
            // schema version's payload being decoded against the current
            // CopySight schema.
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
