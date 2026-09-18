import { describe, expect, it } from 'vitest'
import { parseManageAttesterArgs } from '../../scripts/manageAttester.js'

const RESOLVER = '0x1234567890123456789012345678901234567890'
const ATTESTER = '0xabCDEF1234567890abcdef1234567890ABCDEF12'

describe('parseManageAttesterArgs', () => {
  it('parses a valid authorize call', () => {
    expect(parseManageAttesterArgs(['authorize', ATTESTER], RESOLVER)).toEqual({
      action: 'authorize',
      attesterAddress: ATTESTER,
    })
  })

  it('parses a valid deauthorize call', () => {
    expect(parseManageAttesterArgs(['deauthorize', ATTESTER], RESOLVER)).toEqual({
      action: 'deauthorize',
      attesterAddress: ATTESTER,
    })
  })

  it('throws a usage error when no action is given', () => {
    expect(() => parseManageAttesterArgs([], RESOLVER)).toThrow(/Usage:/)
  })

  it('throws a usage error when the action is not authorize/deauthorize', () => {
    expect(() => parseManageAttesterArgs(['revoke', ATTESTER], RESOLVER)).toThrow(/Usage:/)
  })

  it('throws when the address argument is missing entirely', () => {
    expect(() => parseManageAttesterArgs(['authorize'], RESOLVER)).toThrow(/valid 0x-prefixed address/)
  })

  it('throws when the address is the wrong length', () => {
    expect(() => parseManageAttesterArgs(['authorize', '0x1234'], RESOLVER)).toThrow(/valid 0x-prefixed address/)
  })

  it('throws when the address is missing the 0x prefix', () => {
    const withoutPrefix = ATTESTER.slice(2)
    expect(() => parseManageAttesterArgs(['authorize', withoutPrefix], RESOLVER)).toThrow(
      /valid 0x-prefixed address/
    )
  })

  it('throws when the address contains non-hex characters', () => {
    const invalidAddress = '0xZZZZ567890123456789012345678901234567890'
    expect(() => parseManageAttesterArgs(['authorize', invalidAddress], RESOLVER)).toThrow(
      /valid 0x-prefixed address/
    )
  })

  it('throws when COPYSIGHT_RESOLVER_ADDRESS is not configured', () => {
    expect(() => parseManageAttesterArgs(['authorize', ATTESTER], '')).toThrow(/COPYSIGHT_RESOLVER_ADDRESS/)
  })
})
