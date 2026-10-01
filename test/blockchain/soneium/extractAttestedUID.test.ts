import { describe, expect, it } from 'vitest'
import { Interface } from 'ethers'
import { extractAttestedUID } from '../../../src/blockchain/soneium/SoneiumEASAdapter.js'

const EAS_ATTESTED_EVENT_ABI = [
  'event Attested(address indexed recipient, address indexed attester, bytes32 uid, bytes32 indexed schemaUID)',
]

const RECIPIENT = '0x00000000000000000000000000000000000000ad'
const ATTESTER = '0x000000000000000000000000000000000000a11a'
const SCHEMA_UID = `0x${'22'.repeat(32)}`
const UID = `0x${'33'.repeat(32)}`

/** Builds a real ethers-encoded log via the same Interface extractAttestedUID decodes with, rather than hand-typing hex. */
function realAttestedLog(overrides: { attester?: string; schemaUID?: string; uid?: string } = {}) {
  const iface = new Interface(EAS_ATTESTED_EVENT_ABI)
  const { data, topics } = iface.encodeEventLog('Attested', [
    RECIPIENT,
    overrides.attester ?? ATTESTER,
    overrides.uid ?? UID,
    overrides.schemaUID ?? SCHEMA_UID,
  ])
  return { data, topics: topics as string[] }
}

describe('extractAttestedUID', () => {
  it('finds the UID from a real Attested log matching the expected attester and schema', () => {
    const receipt = { logs: [realAttestedLog()] }
    expect(extractAttestedUID(receipt, ATTESTER, SCHEMA_UID)).toBe(UID)
  })

  it('is case-insensitive on the attester address', () => {
    const receipt = { logs: [realAttestedLog({ attester: ATTESTER.toUpperCase().replace('0X', '0x') })] }
    expect(extractAttestedUID(receipt, ATTESTER, SCHEMA_UID)).toBe(UID)
  })

  it('skips a log from a different attester (e.g. a direct, non-royalty attestation in the same batch)', () => {
    const otherAttester = '0x0000000000000000000000000000000000000bad'
    const receipt = { logs: [realAttestedLog({ attester: otherAttester })] }
    expect(extractAttestedUID(receipt, ATTESTER, SCHEMA_UID)).toBeUndefined()
  })

  it('skips a log for a different schema', () => {
    const otherSchema = `0x${'44'.repeat(32)}`
    const receipt = { logs: [realAttestedLog({ schemaUID: otherSchema })] }
    expect(extractAttestedUID(receipt, ATTESTER, SCHEMA_UID)).toBeUndefined()
  })

  it('is case-insensitive on the schema UID — a COPYSIGHT_SCHEMA_UID configured with uppercase hex must still match', () => {
    const receipt = { logs: [realAttestedLog()] }
    expect(extractAttestedUID(receipt, ATTESTER, SCHEMA_UID.toUpperCase().replace('0X', '0x'))).toBe(UID)
  })

  it('ignores unrelated logs (e.g. the ERC20 Transfer emitted by the royalty payment) rather than throwing', () => {
    const transferIface = new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)'])
    const transferLog = transferIface.encodeEventLog('Transfer', [RECIPIENT, ATTESTER, 100n])
    const receipt = { logs: [{ data: transferLog.data, topics: transferLog.topics as string[] }, realAttestedLog()] }
    expect(extractAttestedUID(receipt, ATTESTER, SCHEMA_UID)).toBe(UID)
  })

  it('returns undefined for a null receipt', () => {
    expect(extractAttestedUID(null, ATTESTER, SCHEMA_UID)).toBeUndefined()
  })

  it('returns undefined when no Attested log is present at all', () => {
    expect(extractAttestedUID({ logs: [] }, ATTESTER, SCHEMA_UID)).toBeUndefined()
  })
})
