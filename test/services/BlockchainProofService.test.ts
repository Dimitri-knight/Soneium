import { describe, expect, it } from 'vitest'
import {
  BlockchainProofService,
  InMemoryBlockchainProofStore,
  type BlockchainProofStore,
} from '../../src/services/BlockchainProofService.js'
import type { AttestationRecord, BlockchainAdapter, TransactionStatus } from '../../src/blockchain/BlockchainAdapter.js'

const SCHEMA_UID = '0x1111111111111111111111111111111111111111111111111111111111111a' as const
const TX_HASH = '0xaaaa000000000000000000000000000000000000000000000000000000000a' as const
const UID = '0xbbbb000000000000000000000000000000000000000000000000000000000b' as const

function fakeAdapter(finalStatus: TransactionStatus = 'CONFIRMED'): BlockchainAdapter {
  return {
    async createAttestation() {
      return { transactionHash: TX_HASH, uid: UID }
    },
    async getAttestation(): Promise<AttestationRecord | null> {
      return null
    },
    async verifyAttestation() {
      return finalStatus === 'CONFIRMED'
    },
    async waitForConfirmation() {
      return finalStatus
    },
  }
}

const params = {
  assetBytes: new TextEncoder().encode('asset bytes'),
  analysis: { copyScore: 75 },
  copyScore: 75,
  analysisVersion: 'v1.0.0',
}

describe('BlockchainProofService', () => {
  it('creates a proof that ends CONFIRMED on the happy path', async () => {
    const service = new BlockchainProofService(fakeAdapter('CONFIRMED'), new InMemoryBlockchainProofStore(), 1946, SCHEMA_UID)

    const proof = await service.createBlockchainProof('asset-1', params)

    expect(proof.status).toBe('CONFIRMED')
    expect(proof.attestationUID).toBe(UID)
    expect(proof.transactionHash).toBe(TX_HASH)
    expect(proof.chainId).toBe(1946)
    expect(proof.schemaUID).toBe(SCHEMA_UID)
    expect(proof.timestamp).not.toBeNull()
  })

  it('reflects FAILED status without throwing, and leaves timestamp null', async () => {
    const service = new BlockchainProofService(fakeAdapter('FAILED'), new InMemoryBlockchainProofStore(), 1946, SCHEMA_UID)

    const proof = await service.createBlockchainProof('asset-2', params)

    expect(proof.status).toBe('FAILED')
    expect(proof.timestamp).toBeNull()
  })

  it('getBlockchainProof retrieves what createBlockchainProof stored', async () => {
    const service = new BlockchainProofService(fakeAdapter('CONFIRMED'), new InMemoryBlockchainProofStore(), 1946, SCHEMA_UID)

    await service.createBlockchainProof('asset-3', params)
    const proof = await service.getBlockchainProof('asset-3')

    expect(proof?.assetId).toBe('asset-3')
  })

  it('getBlockchainProof returns null for an unknown asset', async () => {
    const service = new BlockchainProofService(fakeAdapter(), new InMemoryBlockchainProofStore(), 1946, SCHEMA_UID)
    expect(await service.getBlockchainProof('never-created')).toBeNull()
  })

  it('verifyBlockchainProof is false when no proof exists', async () => {
    const service = new BlockchainProofService(fakeAdapter(), new InMemoryBlockchainProofStore(), 1946, SCHEMA_UID)
    expect(await service.verifyBlockchainProof('never-created')).toBe(false)
  })

  it('verifyBlockchainProof delegates to the adapter once a proof exists', async () => {
    const service = new BlockchainProofService(fakeAdapter('CONFIRMED'), new InMemoryBlockchainProofStore(), 1946, SCHEMA_UID)
    await service.createBlockchainProof('asset-4', params)
    expect(await service.verifyBlockchainProof('asset-4')).toBe(true)
  })

  it('createBlockchainProof stores refUID null by default (first-time proof)', async () => {
    const service = new BlockchainProofService(fakeAdapter('CONFIRMED'), new InMemoryBlockchainProofStore(), 1946, SCHEMA_UID)
    const proof = await service.createBlockchainProof('asset-first', params)
    expect(proof.refUID).toBeNull()
  })

  it('supersedeBlockchainProof links the new proof to the previous one via refUID', async () => {
    const store = new InMemoryBlockchainProofStore()
    const service = new BlockchainProofService(fakeAdapter('CONFIRMED'), store, 1946, SCHEMA_UID)

    const original = await service.createBlockchainProof('asset-v1', params)
    const updated = await service.supersedeBlockchainProof('asset-v2', 'asset-v1', {
      ...params,
      analysisVersion: 'v1.0.1',
    })

    expect(updated.refUID).toBe(original.attestationUID)
  })

  it('supersedeBlockchainProof throws when the referenced asset has no confirmed attestation', async () => {
    const service = new BlockchainProofService(fakeAdapter('CONFIRMED'), new InMemoryBlockchainProofStore(), 1946, SCHEMA_UID)
    await expect(service.supersedeBlockchainProof('asset-v2', 'never-created', params)).rejects.toThrow(
      'Cannot supersede'
    )
  })

  it('idempotency: a second call with identical content aliases the existing proof under the new assetId without re-attesting', async () => {
    let createAttestationCalls = 0
    const countingAdapter: BlockchainAdapter = {
      async createAttestation() {
        createAttestationCalls += 1
        return { transactionHash: TX_HASH, uid: UID }
      },
      async getAttestation() {
        return null
      },
      async verifyAttestation() {
        return true
      },
      async waitForConfirmation() {
        return 'CONFIRMED'
      },
    }
    const service = new BlockchainProofService(countingAdapter, new InMemoryBlockchainProofStore(), 1946, SCHEMA_UID)

    const first = await service.createBlockchainProof('asset-a', params)
    const second = await service.createBlockchainProof('asset-b', params) // same content, different assetId

    expect(createAttestationCalls).toBe(1)
    // Same underlying attestation, but a distinct row under the assetId
    // actually requested — not the other asset's proof verbatim (which
    // would leave getBlockchainProof('asset-b') unable to find anything).
    expect(second).toEqual({ ...first, assetId: 'asset-b' })
    expect(second.attestationUID).toBe(first.attestationUID)

    const lookedUpByNewAssetId = await service.getBlockchainProof('asset-b')
    expect(lookedUpByNewAssetId?.assetId).toBe('asset-b')
    expect(lookedUpByNewAssetId?.attestationUID).toBe(first.attestationUID)
  })

  it('idempotency: different content (different analysisVersion) does NOT get deduped', async () => {
    let createAttestationCalls = 0
    const countingAdapter: BlockchainAdapter = {
      async createAttestation() {
        createAttestationCalls += 1
        return { transactionHash: TX_HASH, uid: UID }
      },
      async getAttestation() {
        return null
      },
      async verifyAttestation() {
        return true
      },
      async waitForConfirmation() {
        return 'CONFIRMED'
      },
    }
    const service = new BlockchainProofService(countingAdapter, new InMemoryBlockchainProofStore(), 1946, SCHEMA_UID)

    await service.createBlockchainProof('asset-c', params)
    await service.createBlockchainProof('asset-d', { ...params, analysisVersion: 'v2.0.0' })

    expect(createAttestationCalls).toBe(2)
  })

  it('idempotency: a previously FAILED proof does not block a fresh attempt', async () => {
    let createAttestationCalls = 0
    let shouldFail = true
    const flakyAdapter: BlockchainAdapter = {
      async createAttestation() {
        createAttestationCalls += 1
        if (shouldFail) throw new Error('transient failure')
        return { transactionHash: TX_HASH, uid: UID }
      },
      async getAttestation() {
        return null
      },
      async verifyAttestation() {
        return true
      },
      async waitForConfirmation() {
        return 'CONFIRMED'
      },
    }
    const service = new BlockchainProofService(flakyAdapter, new InMemoryBlockchainProofStore(), 1946, SCHEMA_UID)

    await expect(service.createBlockchainProof('asset-e', params)).rejects.toThrow('transient failure')
    shouldFail = false
    const retried = await service.createBlockchainProof('asset-f', params) // same content, previous attempt FAILED

    expect(createAttestationCalls).toBe(2)
    expect(retried.status).toBe('CONFIRMED')
  })

  it('reconciliation: a confirmation timeout that actually landed on-chain resolves to CONFIRMED, not stuck PENDING', async () => {
    const reconcilingAdapter: BlockchainAdapter = {
      async createAttestation() {
        return { transactionHash: TX_HASH, uid: UID }
      },
      async getAttestation(uid) {
        // Simulates: the attestation IS actually there when we check, despite the timeout.
        return uid === UID
          ? {
              uid: UID,
              attester: '0x000000000000000000000000000000000000aa',
              recipient: '0x0000000000000000000000000000000000dead',
              schemaUID: SCHEMA_UID,
              timestamp: 1n,
              revoked: false,
              refUID: '0x0000000000000000000000000000000000000000000000000000000000000000',
              data: { assetHash: '0x00', analysisHash: '0x00', copyScore: 75, analysisVersionHash: '0x00' },
            }
          : null
      },
      async verifyAttestation() {
        return true
      },
      async waitForConfirmation() {
        return 'PENDING' // simulates a timeout, not a definitive answer
      },
    }
    const service = new BlockchainProofService(reconcilingAdapter, new InMemoryBlockchainProofStore(), 1946, SCHEMA_UID)

    const proof = await service.createBlockchainProof('asset-g', params)

    expect(proof.status).toBe('CONFIRMED')
  })

  it('reconciliation: a confirmation timeout that genuinely never landed stays PENDING, not falsely CONFIRMED', async () => {
    const genuinelyStuckAdapter: BlockchainAdapter = {
      async createAttestation() {
        return { transactionHash: TX_HASH, uid: UID }
      },
      async getAttestation() {
        return null // never actually landed, even on reconciliation check
      },
      async verifyAttestation() {
        return false
      },
      async waitForConfirmation() {
        return 'PENDING'
      },
    }
    const service = new BlockchainProofService(genuinelyStuckAdapter, new InMemoryBlockchainProofStore(), 1946, SCHEMA_UID)

    const proof = await service.createBlockchainProof('asset-h', params)

    expect(proof.status).toBe('PENDING')
    expect(proof.timestamp).toBeNull()
  })

  it('marks the stored proof FAILED (not stuck at PENDING) when the adapter throws, and rethrows', async () => {
    const throwingAdapter: BlockchainAdapter = {
      async createAttestation() {
        throw new Error('RPC unreachable')
      },
      async getAttestation() {
        return null
      },
      async verifyAttestation() {
        return false
      },
      async waitForConfirmation() {
        return 'FAILED'
      },
    }
    const store = new InMemoryBlockchainProofStore()
    const service = new BlockchainProofService(throwingAdapter, store, 1946, SCHEMA_UID)

    await expect(service.createBlockchainProof('asset-5', params)).rejects.toThrow('RPC unreachable')

    const stored = await store.get('asset-5')
    expect(stored?.status).toBe('FAILED')
  })

  it('createBlockchainProof backfills the real on-chain attester address once the transaction is CONFIRMED', async () => {
    const attesterAddress = '0x000000000000000000000000000000000000aa' as const
    const adapterWithAttester: BlockchainAdapter = {
      async createAttestation() {
        return { transactionHash: TX_HASH, uid: UID }
      },
      async getAttestation(uid) {
        return uid === UID
          ? {
              uid: UID,
              attester: attesterAddress,
              recipient: '0x0000000000000000000000000000000000dead',
              schemaUID: SCHEMA_UID,
              timestamp: 1n,
              revoked: false,
              refUID: '0x0000000000000000000000000000000000000000000000000000000000000000',
              data: { assetHash: '0x00', analysisHash: '0x00', copyScore: 75, analysisVersionHash: '0x00' },
            }
          : null
      },
      async verifyAttestation() {
        return true
      },
      async waitForConfirmation() {
        return 'CONFIRMED'
      },
    }
    const service = new BlockchainProofService(adapterWithAttester, new InMemoryBlockchainProofStore(), 1946, SCHEMA_UID)

    const proof = await service.createBlockchainProof('asset-attester', params)

    expect(proof.attester).toBe(attesterAddress)
  })

  it('supersedeBlockchainProof throws when the previous proof is still PENDING, even though it already has an attestationUID', async () => {
    const genuinelyStuckAdapter: BlockchainAdapter = {
      async createAttestation() {
        return { transactionHash: TX_HASH, uid: UID }
      },
      async getAttestation() {
        return null // never actually landed, even on reconciliation check
      },
      async verifyAttestation() {
        return false
      },
      async waitForConfirmation() {
        return 'PENDING'
      },
    }
    const store = new InMemoryBlockchainProofStore()
    const service = new BlockchainProofService(genuinelyStuckAdapter, store, 1946, SCHEMA_UID)

    const previous = await service.createBlockchainProof('asset-pending-prev', params)
    expect(previous.status).toBe('PENDING')
    expect(previous.attestationUID).toBe(UID) // set at SUBMITTED time, still present despite never confirming

    await expect(
      service.supersedeBlockchainProof('asset-new', 'asset-pending-prev', params)
    ).rejects.toThrow('Cannot supersede')
  })

  it('supersedeBlockchainProof throws when the previous proof ended FAILED after submission, even though it already has an attestationUID', async () => {
    const failsAfterSubmissionAdapter: BlockchainAdapter = {
      async createAttestation() {
        return { transactionHash: TX_HASH, uid: UID }
      },
      async getAttestation() {
        return null
      },
      async verifyAttestation() {
        return false
      },
      async waitForConfirmation() {
        throw new Error('provider dropped connection')
      },
    }
    const store = new InMemoryBlockchainProofStore()
    const service = new BlockchainProofService(failsAfterSubmissionAdapter, store, 1946, SCHEMA_UID)

    await expect(service.createBlockchainProof('asset-failed-prev', params)).rejects.toThrow(
      'provider dropped connection'
    )
    const previous = await store.get('asset-failed-prev')
    expect(previous?.status).toBe('FAILED')
    expect(previous?.attestationUID).toBe(UID) // still set from the earlier SUBMITTED write

    await expect(
      service.supersedeBlockchainProof('asset-new-2', 'asset-failed-prev', params)
    ).rejects.toThrow('Cannot supersede')
  })

  it('concurrent createBlockchainProof calls for identical content attest on-chain only once', async () => {
    let createAttestationCalls = 0
    const countingAdapter: BlockchainAdapter = {
      async createAttestation() {
        createAttestationCalls += 1
        return { transactionHash: TX_HASH, uid: UID }
      },
      async getAttestation() {
        return null
      },
      async verifyAttestation() {
        return true
      },
      async waitForConfirmation() {
        return 'CONFIRMED'
      },
    }
    const service = new BlockchainProofService(countingAdapter, new InMemoryBlockchainProofStore(), 1946, SCHEMA_UID)

    const [first, second] = await Promise.all([
      service.createBlockchainProof('race-a', params),
      service.createBlockchainProof('race-b', params),
    ])

    expect(createAttestationCalls).toBe(1)
    expect(first.attestationUID).toBe(UID)
    expect(second.attestationUID).toBe(UID)
    expect(await service.getBlockchainProof('race-a')).not.toBeNull()
    expect(await service.getBlockchainProof('race-b')).not.toBeNull()
  })

  it('idempotency key includes tenant — two services with different tenants do not dedupe against each other', async () => {
    let createAttestationCalls = 0
    const countingAdapter: BlockchainAdapter = {
      async createAttestation() {
        createAttestationCalls += 1
        return { transactionHash: TX_HASH, uid: UID }
      },
      async getAttestation() {
        return null
      },
      async verifyAttestation() {
        return true
      },
      async waitForConfirmation() {
        return 'CONFIRMED'
      },
    }
    const store = new InMemoryBlockchainProofStore()
    const serviceA = new BlockchainProofService(countingAdapter, store, 1946, SCHEMA_UID, 'tenant-a')
    const serviceB = new BlockchainProofService(countingAdapter, store, 1946, SCHEMA_UID, 'tenant-b')

    const fromA = await serviceA.createBlockchainProof('asset-tenant-a', params)
    const fromB = await serviceB.createBlockchainProof('asset-tenant-b', params)

    expect(createAttestationCalls).toBe(2)
    expect(fromA.idempotencyKey).not.toBe(fromB.idempotencyKey)
  })

  it('verifyBlockchainProof is false when a proof exists but has no attestationUID, without calling adapter.verifyAttestation', async () => {
    let verifyAttestationCalls = 0
    const noUidAdapter: BlockchainAdapter = {
      async createAttestation() {
        return { transactionHash: TX_HASH } // no uid returned
      },
      async getAttestation() {
        return null
      },
      async verifyAttestation() {
        verifyAttestationCalls += 1
        return true
      },
      async waitForConfirmation() {
        return 'CONFIRMED'
      },
    }
    const service = new BlockchainProofService(noUidAdapter, new InMemoryBlockchainProofStore(), 1946, SCHEMA_UID)

    const proof = await service.createBlockchainProof('asset-no-uid', params)
    expect(proof.attestationUID).toBeNull()

    expect(await service.verifyBlockchainProof('asset-no-uid')).toBe(false)
    expect(verifyAttestationCalls).toBe(0)
  })

  it('a store.save() failure after the on-chain call succeeds surfaces the store error as-is, without masking it as a FAILED attestation', async () => {
    const inner = new InMemoryBlockchainProofStore()
    let saveCalls = 0
    const flakyStore: BlockchainProofStore = {
      async save(proof) {
        saveCalls += 1
        if (saveCalls === 2) {
          // Simulates the SUBMITTED-stage persistence write failing right
          // after the on-chain transaction was actually accepted.
          throw new Error('db unavailable')
        }
        await inner.save(proof)
      },
      async get(assetId) {
        return inner.get(assetId)
      },
      async findByIdempotencyKey(key) {
        return inner.findByIdempotencyKey(key)
      },
    }
    const service = new BlockchainProofService(fakeAdapter('CONFIRMED'), flakyStore, 1946, SCHEMA_UID)

    await expect(service.createBlockchainProof('asset-store-fail', params)).rejects.toThrow('db unavailable')

    // The first (PENDING) save succeeded before the second call failed —
    // confirm it was never silently overwritten with a mislabeled FAILED
    // status by a masked/secondary save.
    const stored = await inner.get('asset-store-fail')
    expect(stored?.status).toBe('PENDING')
  })
})
