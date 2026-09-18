import { describe, expect, it } from 'vitest'
import {
  canonicalizeAnalysis,
  hashAnalysis,
  hashAnalysisVersion,
} from '../../../src/core/analysis/AnalysisCanonicalizer.js'

describe('canonicalizeAnalysis', () => {
  it('produces identical output regardless of key order', () => {
    const a = { copyScore: 42, detectedIps: ['x'] }
    const b = { detectedIps: ['x'], copyScore: 42 }
    expect(canonicalizeAnalysis(a)).toBe(canonicalizeAnalysis(b))
  })

  it('sorts keys inside nested objects, recursively', () => {
    const a = { copyScore: 1, meta: { z: 1, y: 2 } }
    const b = { copyScore: 1, meta: { y: 2, z: 1 } }
    expect(canonicalizeAnalysis(a)).toBe(canonicalizeAnalysis(b))
  })

  it('sorts keys inside objects nested in arrays', () => {
    const a = { items: [{ z: 1, y: 2 }, { b: 1, a: 2 }] }
    const b = { items: [{ y: 2, z: 1 }, { a: 2, b: 1 }] }
    expect(canonicalizeAnalysis(a)).toBe(canonicalizeAnalysis(b))
  })

  it('stores a literal __proto__ key as real data instead of mutating the accumulator prototype', () => {
    const withMalicious = JSON.parse('{"copyScore":1,"__proto__":{"malicious":"A"}}') as Record<
      string,
      unknown
    >
    const withoutKey = { copyScore: 1 }
    const canonical = canonicalizeAnalysis(withMalicious)
    expect(canonical).toContain('__proto__')
    expect(canonical).toContain('malicious')
    expect(canonical).not.toBe(canonicalizeAnalysis(withoutKey))
  })

  it('produces different output for different __proto__ values (no silent collision)', () => {
    const a = JSON.parse('{"copyScore":1,"__proto__":{"malicious":"A"}}') as Record<string, unknown>
    const b = JSON.parse('{"copyScore":1,"__proto__":{"malicious":"B"}}') as Record<string, unknown>
    expect(canonicalizeAnalysis(a)).not.toBe(canonicalizeAnalysis(b))
  })

  it('rejects a Date value rather than silently canonicalizing it to {}', () => {
    expect(() => canonicalizeAnalysis({ copyScore: 1, when: new Date('2020-01-01') })).toThrow()
  })

  it('rejects Map and Set values', () => {
    expect(() => canonicalizeAnalysis({ copyScore: 1, tags: new Set(['a']) })).toThrow()
    expect(() => canonicalizeAnalysis({ copyScore: 1, tags: new Map([['a', 1]]) })).toThrow()
  })

  it('rejects non-finite numbers rather than silently coercing them to null', () => {
    expect(() => canonicalizeAnalysis({ copyScore: NaN })).toThrow()
    expect(() => canonicalizeAnalysis({ copyScore: Infinity })).toThrow()
    expect(() => canonicalizeAnalysis({ copyScore: -Infinity })).toThrow()
  })
})

describe('hashAnalysis', () => {
  it('is deterministic regardless of key order', () => {
    const a = { copyScore: 42, detectedIps: ['x'] }
    const b = { detectedIps: ['x'], copyScore: 42 }
    expect(hashAnalysis(a)).toBe(hashAnalysis(b))
  })

  it('produces different hashes for different results', () => {
    expect(hashAnalysis({ copyScore: 42 })).not.toBe(hashAnalysis({ copyScore: 43 }))
  })

  it('produces different hashes for different __proto__ payloads (no silent collision)', () => {
    const a = JSON.parse('{"copyScore":1,"__proto__":{"malicious":"A"}}') as Record<string, unknown>
    const b = JSON.parse('{"copyScore":1,"__proto__":{"malicious":"B"}}') as Record<string, unknown>
    const withoutKey = { copyScore: 1 }
    expect(hashAnalysis(a)).not.toBe(hashAnalysis(b))
    expect(hashAnalysis(a)).not.toBe(hashAnalysis(withoutKey))
  })
})

describe('hashAnalysisVersion', () => {
  it('is deterministic', () => {
    expect(hashAnalysisVersion('v1.0.0')).toBe(hashAnalysisVersion('v1.0.0'))
  })

  it('differs across versions', () => {
    expect(hashAnalysisVersion('v1.0.0')).not.toBe(hashAnalysisVersion('v1.0.1'))
  })
})
