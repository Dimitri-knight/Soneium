import { describe, expect, it } from 'vitest'
import { classifyError } from '../../../src/core/logging/errorClassification.js'

describe('classifyError', () => {
  it('classifies a CALL_EXCEPTION, extracting reason and data — the shape a CopySightResolver rejection actually has', () => {
    const err = Object.assign(new Error('execution reverted'), {
      code: 'CALL_EXCEPTION',
      shortMessage: 'execution reverted (unknown custom error)',
      reason: null,
      data: '0x93693b7a',
    })
    expect(classifyError(err)).toEqual({
      kind: 'CALL_EXCEPTION',
      message: 'execution reverted (unknown custom error)',
      reason: null,
      data: '0x93693b7a',
    })
  })

  it('classifies a CALL_EXCEPTION with a real human-readable reason', () => {
    const err = Object.assign(new Error('execution reverted: insufficient balance'), {
      code: 'CALL_EXCEPTION',
      shortMessage: 'execution reverted: "insufficient balance"',
      reason: 'insufficient balance',
      data: '0xdeadbeef',
    })
    expect(classifyError(err).reason).toBe('insufficient balance')
  })

  it('classifies a generic ethers error kind (e.g. INSUFFICIENT_FUNDS) using its code and shortMessage', () => {
    const err = Object.assign(new Error('insufficient funds'), {
      code: 'INSUFFICIENT_FUNDS',
      shortMessage: 'insufficient funds for intrinsic transaction cost',
    })
    expect(classifyError(err)).toEqual({
      kind: 'INSUFFICIENT_FUNDS',
      message: 'insufficient funds for intrinsic transaction cost',
    })
  })

  it('falls back to err.message when a coded error has no shortMessage', () => {
    const err = Object.assign(new Error('nonce too low'), { code: 'NONCE_EXPIRED' })
    expect(classifyError(err)).toEqual({ kind: 'NONCE_EXPIRED', message: 'nonce too low' })
  })

  it('classifies a plain Error with no ethers .code as UNKNOWN, not as a network/chain issue', () => {
    const err = new Error('store write failed')
    expect(classifyError(err)).toEqual({ kind: 'UNKNOWN', message: 'store write failed' })
  })

  it('handles a thrown non-Error value without crashing', () => {
    expect(classifyError('just a string')).toEqual({ kind: 'UNKNOWN', message: 'just a string' })
    expect(classifyError(undefined)).toEqual({ kind: 'UNKNOWN', message: 'undefined' })
  })
})
