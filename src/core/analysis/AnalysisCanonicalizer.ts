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
  if (typeof value === 'number' && !Number.isFinite(value)) {
    // JSON.stringify silently turns NaN/Infinity into `null`, which would let two
    // different payloads hash the same.
    throw new Error(`Cannot canonicalize non-finite number: ${value}`)
  }
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value instanceof Date) {
    // A Date has no own enumerable keys, so it would otherwise canonicalize to '{}'
    // regardless of its value.
    throw new Error('Cannot canonicalize a Date value — normalize to an ISO string before hashing')
  }
  if (value instanceof Map || value instanceof Set) {
    throw new Error(
      `Cannot canonicalize a ${value.constructor.name} value — normalize to a plain array/object before hashing`
    )
  }
  if (value !== null && typeof value === 'object') {
    // Object.create(null) so a literal `__proto__` key lands as a normal data property
    // instead of reassigning the accumulator's prototype (a plain `{}` would silently
    // drop that key's value).
    const acc = Object.create(null) as Record<string, unknown>
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      acc[key] = sortKeysDeep((value as Record<string, unknown>)[key])
    }
    return acc
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
