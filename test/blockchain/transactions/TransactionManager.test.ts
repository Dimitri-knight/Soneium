import { describe, expect, it, vi } from 'vitest'
import { computeIdempotencyKey, withRetry } from '../../../src/blockchain/transactions/TransactionManager.js'

const baseInput = {
  tenant: 'copysight',
  assetHash: '0x1111111111111111111111111111111111111111111111111111111111111a' as const,
  analysisVersionHash: '0x2222222222222222222222222222222222222222222222222222222222222b' as const,
  schemaUID: '0x3333333333333333333333333333333333333333333333333333333333333c' as const,
}

describe('computeIdempotencyKey', () => {
  it('is deterministic for identical input', () => {
    expect(computeIdempotencyKey(baseInput)).toBe(computeIdempotencyKey(baseInput))
  })

  it('differs when any field changes', () => {
    const key1 = computeIdempotencyKey(baseInput)
    const key2 = computeIdempotencyKey({ ...baseInput, tenant: 'someone-else' })
    expect(key1).not.toBe(key2)
  })
})

describe('withRetry', () => {
  it('returns the result immediately on first success, no retries needed', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await withRetry(fn, { baseDelayMs: 1 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries a transient failure and eventually succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('ok')

    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('rethrows the last error once maxAttempts is exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'))
    await expect(withRetry(fn, { maxAttempts: 2, baseDelayMs: 1 })).rejects.toThrow('always fails')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
