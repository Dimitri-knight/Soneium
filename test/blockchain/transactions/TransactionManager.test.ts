import { describe, expect, it, vi } from 'vitest'
import { computeIdempotencyKey, recoverStuckAttestation, withRetry } from '../../../src/blockchain/transactions/TransactionManager.js'
import type { AttestationRecord, BlockchainAdapter } from '../../../src/blockchain/BlockchainAdapter.js'

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

  it('differs when only assetHash changes, all other fields held fixed', () => {
    const key1 = computeIdempotencyKey(baseInput)
    const key2 = computeIdempotencyKey({
      ...baseInput,
      assetHash: '0x9999999999999999999999999999999999999999999999999999999999999a',
    })
    expect(key1).not.toBe(key2)
  })

  it('differs when only analysisVersionHash changes, all other fields held fixed', () => {
    const key1 = computeIdempotencyKey(baseInput)
    const key2 = computeIdempotencyKey({
      ...baseInput,
      analysisVersionHash: '0x9999999999999999999999999999999999999999999999999999999999999a',
    })
    expect(key1).not.toBe(key2)
  })

  it('differs when only schemaUID changes, all other fields held fixed', () => {
    const key1 = computeIdempotencyKey(baseInput)
    const key2 = computeIdempotencyKey({
      ...baseInput,
      schemaUID: '0x9999999999999999999999999999999999999999999999999999999999999a',
    })
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

  it('waits with exponential backoff (baseDelayMs, then 2x, then 4x) between attempts, not a linear/constant delay', async () => {
    vi.useFakeTimers()
    try {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail1'))
        .mockRejectedValueOnce(new Error('fail2'))
        .mockRejectedValueOnce(new Error('fail3'))
        .mockResolvedValueOnce('ok')

      const resultPromise = withRetry(fn, { maxAttempts: 4, baseDelayMs: 100 })

      // Attempt 1 runs right away and rejects, scheduling the first backoff.
      await vi.advanceTimersByTimeAsync(0)
      expect(fn).toHaveBeenCalledTimes(1)

      // First backoff is baseDelayMs * 2^0 = 100ms — not before, exactly at.
      await vi.advanceTimersByTimeAsync(99)
      expect(fn).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(fn).toHaveBeenCalledTimes(2)

      // Second backoff is baseDelayMs * 2^1 = 200ms.
      await vi.advanceTimersByTimeAsync(199)
      expect(fn).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(fn).toHaveBeenCalledTimes(3)

      // Third backoff is baseDelayMs * 2^2 = 400ms.
      await vi.advanceTimersByTimeAsync(399)
      expect(fn).toHaveBeenCalledTimes(3)
      await vi.advanceTimersByTimeAsync(1)
      expect(fn).toHaveBeenCalledTimes(4)

      expect(await resultPromise).toBe('ok')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does NOT retry a CALL_EXCEPTION (an on-chain revert, e.g. CopySightResolver rejecting an unauthorized attester) — rethrows immediately since retrying would fail identically every time', async () => {
    const revertError = Object.assign(new Error('execution reverted'), {
      code: 'CALL_EXCEPTION',
      shortMessage: 'execution reverted (unknown custom error)',
      reason: null,
      data: '0x93693b7a',
    })
    const fn = vi.fn().mockRejectedValue(revertError)

    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })).rejects.toBe(revertError)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry INSUFFICIENT_FUNDS — a real ethers error kind, distinct from a generic/unknown failure', async () => {
    const fundsError = Object.assign(new Error('insufficient funds'), {
      code: 'INSUFFICIENT_FUNDS',
      shortMessage: 'insufficient funds for intrinsic transaction cost',
    })
    const fn = vi.fn().mockRejectedValue(fundsError)

    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })).rejects.toBe(fundsError)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('still retries a plain Error with no ethers .code (classified UNKNOWN) — preserves this function\'s original behavior for non-ethers failures', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('transient, no code')).mockResolvedValueOnce('ok')
    const result = await withRetry(fn, { maxAttempts: 2, baseDelayMs: 1 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

const UID = '0x4444444444444444444444444444444444444444444444444444444444444d' as const

function fakeAdapter(hasRecord: boolean): BlockchainAdapter {
  return {
    async createAttestation() {
      throw new Error('not used in these tests')
    },
    async getAttestation(): Promise<AttestationRecord | null> {
      if (!hasRecord) return null
      return {
        uid: UID,
        attester: '0x000000000000000000000000000000000000aa',
        recipient: '0x0000000000000000000000000000000000dead',
        schemaUID: '0x00',
        timestamp: 1n,
        revoked: false,
        refUID: '0x00',
        data: { assetHash: '0x00', analysisHash: '0x00', copyScore: 50, analysisVersionHash: '0x00' },
      } as unknown as AttestationRecord
    },
    async verifyAttestation() {
      return hasRecord
    },
    async waitForConfirmation() {
      return 'PENDING'
    },
  }
}

describe('recoverStuckAttestation', () => {
  it('reports ALREADY_CONFIRMED when the attestation is actually found despite the timeout', async () => {
    expect(await recoverStuckAttestation(fakeAdapter(true), UID)).toBe('ALREADY_CONFIRMED')
  })

  it('reports NEEDS_RESUBMIT when the attestation genuinely is not there', async () => {
    expect(await recoverStuckAttestation(fakeAdapter(false), UID)).toBe('NEEDS_RESUBMIT')
  })

  it('reports NEEDS_RESUBMIT immediately when no UID was ever returned, without calling the adapter', async () => {
    const adapter = fakeAdapter(true)
    const spy = vi.spyOn(adapter, 'getAttestation')
    expect(await recoverStuckAttestation(adapter, undefined)).toBe('NEEDS_RESUBMIT')
    expect(spy).not.toHaveBeenCalled()
  })
})
