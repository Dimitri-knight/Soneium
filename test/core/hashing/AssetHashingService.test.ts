import { describe, expect, it } from 'vitest'
import { hashAsset } from '../../../src/core/hashing/AssetHashingService.js'

describe('hashAsset', () => {
  it('is deterministic — same bytes produce the same hash', () => {
    const bytes = new TextEncoder().encode('hello world')
    expect(hashAsset(bytes)).toBe(hashAsset(bytes))
  })

  it('produces different hashes for different input', () => {
    const a = new TextEncoder().encode('asset A')
    const b = new TextEncoder().encode('asset B')
    expect(hashAsset(a)).not.toBe(hashAsset(b))
  })

  it('returns a 32-byte, 0x-prefixed hex string', () => {
    const hash = hashAsset(new TextEncoder().encode('anything'))
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('hashes an empty (zero-byte) asset deterministically', () => {
    const empty = new Uint8Array(0)
    const hash = hashAsset(empty)
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(hash).toBe(hashAsset(new Uint8Array(0)))
  })
})
