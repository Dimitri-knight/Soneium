import { sha256, stringToBytes } from 'viem'

export type AnalysisResult = Record<string, unknown>

const DOMAIN_PREFIX = 'COPYSIGHT_ANALYSIS_V1'

/**
 * Deterministic JSON serialization — sorted keys, recursively, no
 * whitespace. Ensures hashAnalysis() is stable regardless of the order
 * keys happen to appear in the source object.
 */
export function canonicalizeAnalysis(result: AnalysisResult): string {
  return JSON.stringify(sortKeysDeep(result))
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value !== null && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep((value as Record<string, unknown>)[key])
        return acc
      }, {})
  }
  return value
}

/**
 * Hash of the canonicalized analysis result, domain-separated so this can
 * never collide with a hash produced for a different purpose or version.
 */
export function hashAnalysis(result: AnalysisResult): `0x${string}` {
  const canonical = canonicalizeAnalysis(result)
  return sha256(stringToBytes(`${DOMAIN_PREFIX}:${canonical}`))
}

/** Hash of the analysis engine/model version string — same domain-separation approach. */
export function hashAnalysisVersion(version: string): `0x${string}` {
  return sha256(stringToBytes(`${DOMAIN_PREFIX}_VERSION:${version}`))
}
