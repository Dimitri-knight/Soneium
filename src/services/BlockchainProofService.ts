import { buildAttestationPayload, type BuildAttestationPayloadParams } from '../core/attestation/AttestationBuilder.js'
import type { BlockchainAdapter } from '../blockchain/BlockchainAdapter.js'
import type { BlockchainProof } from '../models/BlockchainProof.js'

/** Minimal persistence seam — swap for a real DB-backed implementation later. */
export interface BlockchainProofStore {
  save(proof: BlockchainProof): Promise<void>
  get(assetId: string): Promise<BlockchainProof | null>
}

/** In-memory implementation for tests/local dev. Not for real use — nothing persists across a restart. */
export class InMemoryBlockchainProofStore implements BlockchainProofStore {
  private readonly records = new Map<string, BlockchainProof>()

  async save(proof: BlockchainProof): Promise<void> {
    this.records.set(proof.assetId, proof)
  }

  async get(assetId: string): Promise<BlockchainProof | null> {
    return this.records.get(assetId) ?? null
  }
}

/**
 * Orchestration layer between CopySight's own analysis pipeline and the
 * blockchain module. Depends only on BlockchainAdapter and
 * BlockchainProofStore — never on Soneium/EAS specifics or a concrete
 * database — so this is fully testable with fakes for both.
 *
 * DESIGN DECISION MADE HERE, FLAG TO ARCHITECT: createBlockchainProof()
 * blocks/awaits until the transaction is CONFIRMED before returning,
 * rather than returning immediately as PENDING and updating status via
 * a background job/webhook later. Chosen for simplicity at this volume;
 * revisit if the demo needs non-blocking UX (spinner vs. "submitted,
 * check back").
 */
export class BlockchainProofService {
  constructor(
    private readonly adapter: BlockchainAdapter,
    private readonly store: BlockchainProofStore,
    private readonly chainId: number,
    private readonly schemaUID: `0x${string}`
  ) {}

  async createBlockchainProof(
    assetId: string,
    params: BuildAttestationPayloadParams
  ): Promise<BlockchainProof> {
    const payload = buildAttestationPayload(params)

    let proof: BlockchainProof = {
      assetId,
      assetHash: payload.assetHash,
      analysisHash: payload.analysisHash,
      copyScore: payload.copyScore,
      analysisVersion: params.analysisVersion,
      analysisVersionHash: payload.analysisVersionHash,
      chainId: this.chainId,
      schemaUID: this.schemaUID,
      attestationUID: null,
      transactionHash: null,
      attester: null,
      status: 'PENDING',
      timestamp: null,
    }
    await this.store.save(proof)

    const { transactionHash, uid } = await this.adapter.createAttestation(payload)
    proof = { ...proof, transactionHash, attestationUID: uid ?? null, status: 'SUBMITTED' }
    await this.store.save(proof)

    const status = await this.adapter.waitForConfirmation(transactionHash)
    proof = { ...proof, status, timestamp: status === 'CONFIRMED' ? Date.now() : null }
    await this.store.save(proof)

    return proof
  }

  async getBlockchainProof(assetId: string): Promise<BlockchainProof | null> {
    return this.store.get(assetId)
  }

  async verifyBlockchainProof(assetId: string): Promise<boolean> {
    const proof = await this.store.get(assetId)
    if (!proof || !proof.attestationUID) return false
    return this.adapter.verifyAttestation(proof.attestationUID)
  }
}
