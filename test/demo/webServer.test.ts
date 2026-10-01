import { describe, expect, it } from 'vitest'
import { isValidAttestationInput } from '../../demo/webServer.js'

const HASH_A = `0x${'aa'.repeat(32)}`
const HASH_B = `0x${'bb'.repeat(32)}`
const HASH_C = `0x${'cc'.repeat(32)}`

const valid = {
  assetHash: HASH_A,
  analysisHash: HASH_B,
  analysisVersionHash: HASH_C,
  copyScore: 50,
}

describe('isValidAttestationInput', () => {
  it('accepts a well-formed payload', () => {
    expect(isValidAttestationInput(valid)).toBe(true)
  })

  it('accepts the copyScore boundaries 0 and 100', () => {
    expect(isValidAttestationInput({ ...valid, copyScore: 0 })).toBe(true)
    expect(isValidAttestationInput({ ...valid, copyScore: 100 })).toBe(true)
  })

  it('rejects null, undefined, and non-object values', () => {
    expect(isValidAttestationInput(null)).toBe(false)
    expect(isValidAttestationInput(undefined)).toBe(false)
    expect(isValidAttestationInput('not an object')).toBe(false)
    expect(isValidAttestationInput(42)).toBe(false)
  })

  it('rejects a missing hex field', () => {
    const { assetHash: _assetHash, ...withoutAssetHash } = valid
    expect(isValidAttestationInput(withoutAssetHash)).toBe(false)
  })

  it('rejects a malformed hex field (wrong length)', () => {
    expect(isValidAttestationInput({ ...valid, assetHash: '0xbad' })).toBe(false)
  })

  it('rejects a hex field missing its 0x prefix', () => {
    expect(isValidAttestationInput({ ...valid, analysisHash: 'aa'.repeat(32) })).toBe(false)
  })

  it('rejects copyScore out of range', () => {
    expect(isValidAttestationInput({ ...valid, copyScore: 101 })).toBe(false)
    expect(isValidAttestationInput({ ...valid, copyScore: -1 })).toBe(false)
  })

  it('rejects a non-integer copyScore', () => {
    expect(isValidAttestationInput({ ...valid, copyScore: 50.5 })).toBe(false)
  })
})
