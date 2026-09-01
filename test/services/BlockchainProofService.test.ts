import { describe, expect, it } from 'vitest'
import {
  BlockchainProofService,
  InMemoryBlockchainProofStore,
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
})
