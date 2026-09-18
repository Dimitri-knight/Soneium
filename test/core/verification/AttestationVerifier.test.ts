import { describe, expect, it } from 'vitest'
import { AttestationVerifier } from '../../../src/core/verification/AttestationVerifier.js'
import { hashAsset } from '../../../src/core/hashing/AssetHashingService.js'
import { hashAnalysis } from '../../../src/core/analysis/AnalysisCanonicalizer.js'
import type { AttestationRecord, BlockchainAdapter } from '../../../src/blockchain/BlockchainAdapter.js'

const SCHEMA_UID = '0x1111111111111111111111111111111111111111111111111111111111111a' as const
const OTHER_SCHEMA_UID = '0x2222222222222222222222222222222222222222222222222222222222222b' as const
const ATTESTER = '0x000000000000000000000000000000000000aa' as const
const OTHER_ATTESTER = '0x000000000000000000000000000000000000bb' as const

const assetBytes = new TextEncoder().encode('asset bytes')
const analysis = { copyScore: 90 }

function fakeAdapter(record: AttestationRecord | null): BlockchainAdapter {
  return {
    async createAttestation() {
      throw new Error('not used in these tests')
    },
    async getAttestation() {
      return record
    },
    async verifyAttestation() {
      return record !== null
    },
    async waitForConfirmation() {
      return 'CONFIRMED'
    },
  }
}

const UID = '0x3333333333333333333333333333333333333333333333333333333333333c' as const

describe('AttestationVerifier', () => {
  const validRecord: AttestationRecord = {
    uid: UID,
    attester: ATTESTER,
    recipient: '0x0000000000000000000000000000000000dead',
    schemaUID: SCHEMA_UID,
    timestamp: 1n,
    revoked: false,
    refUID: '0x0000000000000000000000000000000000000000000000000000000000000000',
    data: {
      assetHash: hashAsset(assetBytes),
      analysisHash: hashAnalysis(analysis),
      copyScore: 90,
      analysisVersionHash: '0x00',
    },
  }

  it('verifySchema passes for a matching schema, fails for a mismatch', async () => {
    const okVerifier = new AttestationVerifier(fakeAdapter(validRecord), SCHEMA_UID)
    expect(await okVerifier.verifySchema(UID)).toBe(true)

    const wrongVerifier = new AttestationVerifier(fakeAdapter(validRecord), OTHER_SCHEMA_UID)
    expect(await wrongVerifier.verifySchema(UID)).toBe(false)
  })

  it('verifyAttester passes for the expected attester, fails for another', async () => {
    const okVerifier = new AttestationVerifier(fakeAdapter(validRecord), SCHEMA_UID, ATTESTER)
    expect(await okVerifier.verifyAttester(UID)).toBe(true)

    const wrongVerifier = new AttestationVerifier(fakeAdapter(validRecord), SCHEMA_UID, OTHER_ATTESTER)
    expect(await wrongVerifier.verifyAttester(UID)).toBe(false)
  })

  it('verifyAttester passes regardless of attester when no allowlist is configured', async () => {
    const noAllowlistVerifier = new AttestationVerifier(fakeAdapter(validRecord), SCHEMA_UID)
    expect(await noAllowlistVerifier.verifyAttester(UID)).toBe(true)

    const recordFromOther: AttestationRecord = { ...validRecord, attester: OTHER_ATTESTER }
    const stillNoAllowlist = new AttestationVerifier(fakeAdapter(recordFromOther), SCHEMA_UID)
    expect(await stillNoAllowlist.verifyAttester(UID)).toBe(true)
  })

  it('verifyAttester compares addresses case-insensitively', async () => {
    const mixedCaseAttester = '0x000000000000000000000000000000000000AA' as const
    const recordWithMixedCase: AttestationRecord = { ...validRecord, attester: mixedCaseAttester }
    const differentCaseExpected = '0x000000000000000000000000000000000000aa' as const

    const verifier = new AttestationVerifier(
      fakeAdapter(recordWithMixedCase),
      SCHEMA_UID,
      differentCaseExpected
    )
    expect(await verifier.verifyAttester(UID)).toBe(true)
  })

  it('verifyAsset passes only when bytes hash to the recorded assetHash', async () => {
    const verifier = new AttestationVerifier(fakeAdapter(validRecord), SCHEMA_UID)
    expect(await verifier.verifyAsset(UID, assetBytes)).toBe(true)
    expect(await verifier.verifyAsset(UID, new TextEncoder().encode('different bytes'))).toBe(false)
  })

  it('verifyAnalysis passes only when the result hashes to the recorded analysisHash', async () => {
    const verifier = new AttestationVerifier(fakeAdapter(validRecord), SCHEMA_UID)
    expect(await verifier.verifyAnalysis(UID, analysis)).toBe(true)
    expect(await verifier.verifyAnalysis(UID, { copyScore: 10 })).toBe(false)
  })

  it('every check fails cleanly when the attestation does not exist', async () => {
    const verifier = new AttestationVerifier(fakeAdapter(null), SCHEMA_UID, ATTESTER)
    expect(await verifier.verifySchema(UID)).toBe(false)
    expect(await verifier.verifyAttester(UID)).toBe(false)
    expect(await verifier.verifyAsset(UID, assetBytes)).toBe(false)
    expect(await verifier.verifyAnalysis(UID, analysis)).toBe(false)
    expect(await verifier.verifyNotRevoked(UID)).toBe(false)
  })

  it('verifyNotRevoked passes for an active attestation, fails for a revoked one', async () => {
    const activeVerifier = new AttestationVerifier(fakeAdapter(validRecord), SCHEMA_UID)
    expect(await activeVerifier.verifyNotRevoked(UID)).toBe(true)

    const revokedVerifier = new AttestationVerifier(fakeAdapter({ ...validRecord, revoked: true }), SCHEMA_UID)
    expect(await revokedVerifier.verifyNotRevoked(UID)).toBe(false)
  })
})
