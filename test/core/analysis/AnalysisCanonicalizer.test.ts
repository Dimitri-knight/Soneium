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
})

describe('hashAnalysisVersion', () => {
  it('is deterministic', () => {
    expect(hashAnalysisVersion('v1.0.0')).toBe(hashAnalysisVersion('v1.0.0'))
  })

  it('differs across versions', () => {
    expect(hashAnalysisVersion('v1.0.0')).not.toBe(hashAnalysisVersion('v1.0.1'))
  })
})
