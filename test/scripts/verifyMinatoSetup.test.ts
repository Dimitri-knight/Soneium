import { describe, expect, it } from 'vitest'
import { evaluateMinatoSetup } from '../../scripts/verifyMinatoSetup.js'

/**
 * evaluateMinatoSetup is the pure pass/fail logic extracted from
 * verifyMinatoSetup.ts's main(), so it's tested here with fabricated
 * inputs instead of a real RPC call.
 */
const passingInputs = {
  chainId: 1946,
  blockNumber: 123n,
  schemaRegistryCode: '0xabc123',
  easCode: '0xdef456',
  schemaUID: '',
  attesterPrivateKey: '',
}

describe('evaluateMinatoSetup', () => {
  it('passes when chainId matches and both contracts have code', () => {
    const { ok, lines } = evaluateMinatoSetup(passingInputs)
    expect(ok).toBe(true)
    expect(lines.some((l) => l.startsWith('[FAIL]'))).toBe(false)
    expect(lines).toContain('chainId=1946 (expected 1946)')
  })

  it('fails when chainId does not match the expected Minato chain id', () => {
    const { ok, lines } = evaluateMinatoSetup({ ...passingInputs, chainId: 1 })
    expect(ok).toBe(false)
    expect(lines.some((l) => l.startsWith('[FAIL]') && l.includes('chainId'))).toBe(true)
  })

  it('fails when SchemaRegistry has no code at the configured address', () => {
    const { ok, lines } = evaluateMinatoSetup({ ...passingInputs, schemaRegistryCode: undefined })
    expect(ok).toBe(false)
    expect(lines).toContain('SchemaRegistry has code: false')
    expect(lines.some((l) => l.startsWith('[FAIL]') && l.includes('SchemaRegistry'))).toBe(true)
  })

  it('fails when EAS has no code at the configured address', () => {
    const { ok, lines } = evaluateMinatoSetup({ ...passingInputs, easCode: undefined })
    expect(ok).toBe(false)
    expect(lines).toContain('EAS has code: false')
    expect(lines.some((l) => l.startsWith('[FAIL]') && l.includes('EAS'))).toBe(true)
  })

  it('fails on every check at once when everything is broken', () => {
    const { ok, lines } = evaluateMinatoSetup({
      ...passingInputs,
      chainId: 99999,
      schemaRegistryCode: undefined,
      easCode: undefined,
    })
    expect(ok).toBe(false)
    expect(lines.filter((l) => l.startsWith('[FAIL]'))).toHaveLength(3)
  })

  it('reports COPYSIGHT_SCHEMA_UID as unset without failing the check (legitimately optional at this stage)', () => {
    const { ok, lines } = evaluateMinatoSetup({ ...passingInputs, schemaUID: '' })
    expect(ok).toBe(true)
    expect(lines).toContain('COPYSIGHT_SCHEMA_UID not set yet — schema not registered.')
  })

  it('reports COPYSIGHT_SCHEMA_UID when it is set', () => {
    const { ok, lines } = evaluateMinatoSetup({ ...passingInputs, schemaUID: '0x1234' })
    expect(ok).toBe(true)
    expect(lines).toContain('COPYSIGHT_SCHEMA_UID is set: 0x1234')
  })

  it('reports COPYSIGHT_ATTESTER_PRIVATE_KEY as unset without failing the check (wallet not funded yet)', () => {
    const { ok, lines } = evaluateMinatoSetup({ ...passingInputs, attesterPrivateKey: '' })
    expect(ok).toBe(true)
    expect(lines).toContain('COPYSIGHT_ATTESTER_PRIVATE_KEY not set — wallet not configured yet.')
  })

  it('reports COPYSIGHT_ATTESTER_PRIVATE_KEY when it is set', () => {
    const { ok, lines } = evaluateMinatoSetup({ ...passingInputs, attesterPrivateKey: 'some-private-key' })
    expect(ok).toBe(true)
    expect(lines).toContain('COPYSIGHT_ATTESTER_PRIVATE_KEY is set.')
  })
})
