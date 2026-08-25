import { beforeAll, describe, expect, it } from 'vitest'
import { sha256, stringToBytes } from 'viem'
import { SoneiumEASAdapter } from '../../src/blockchain/soneium/SoneiumEASAdapter.js'
import { config } from '../../src/blockchain/soneium/config.js'
import type { AttestationInput, TransactionStatus } from '../../src/blockchain/BlockchainAdapter.js'

/**
 * Real end-to-end tests against live Minato. Skipped automatically
 * unless COPYSIGHT_ATTESTER_PRIVATE_KEY and COPYSIGHT_SCHEMA_UID are
 * both set — currently blocked on the Minato faucet (wallet not funded)
 * and schema registration (pending Architect sign-off on schema
 * content). Fill in .env once unblocked; this file activates on its
 * own, no code changes needed.
 *
 * Costs real (test) gas — one attestation is created in beforeAll and
 * reused across the read-only assertions below, rather than a fresh
 * transaction per test.
 */
const isConfigured = Boolean(config.attesterPrivateKey && config.schemaUID)

describe.skipIf(!isConfigured)('SoneiumEASAdapter — live Minato E2E', () => {
  let adapter: SoneiumEASAdapter
  let input: AttestationInput
  let transactionHash: `0x${string}`
  let uid: `0x${string}`
  let confirmationStatus: TransactionStatus

  beforeAll(async () => {
    adapter = new SoneiumEASAdapter()
    input = {
      assetHash: sha256(stringToBytes(`e2e-asset-${Date.now()}`)),
      analysisHash: sha256(stringToBytes('e2e-analysis')),
      copyScore: 42,
      analysisVersionHash: sha256(stringToBytes('v1.0.0-e2e')),
    }

    const result = await adapter.createAttestation(input)
    transactionHash = result.transactionHash
    uid = result.uid!
    confirmationStatus = await adapter.waitForConfirmation(transactionHash)
  }, 60_000)

  it('confirms on-chain', () => {
    expect(confirmationStatus).toBe('CONFIRMED')
  })

  it('returns a real attestation UID', () => {
    expect(uid).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('retrieves the attestation and the decoded data matches what was sent', async () => {
    const record = await adapter.getAttestation(uid)
    expect(record).not.toBeNull()
    expect(record?.data).toEqual(input)
  })

  it('verifyAttestation passes for this real, correctly-attested UID', async () => {
    expect(await adapter.verifyAttestation(uid)).toBe(true)
  })

  it('verifyAttestation fails for a UID that does not exist', async () => {
    const fakeUID = `0x${'0'.repeat(64)}` as `0x${string}`
    expect(await adapter.verifyAttestation(fakeUID)).toBe(false)
  })

  it('documents actual duplicate behavior — EAS does not dedupe identical input, produces a distinct UID', async () => {
    const second = await adapter.createAttestation(input)
    expect(second.uid).not.toBe(uid)
    // Idempotency prevention is the caller's job (see TransactionManager's
    // computeIdempotencyKey) — EAS itself will happily attest the same
    // data twice with two different UIDs. This documents that fact rather
    // than asserting protection that doesn't actually exist at this layer.
  }, 60_000)
})
