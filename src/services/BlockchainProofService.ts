import { buildAttestationPayload, type BuildAttestationPayloadParams } from '../core/attestation/AttestationBuilder.js'
import { logger } from '../core/logging/logger.js'
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
      refUID: params.refUID ?? null,
    }
    await this.store.save(proof)
    logger.info('blockchain_proof.pending', { assetId, assetHash: payload.assetHash })

    // Everything past this point can fail on a live network (RPC error,
    // reverted tx, timeout). Without this try/catch, a thrown error here
    // would leave the record stuck at PENDING forever instead of
    // reflecting what actually happened — found while reviewing the
    // happy-path-only version of this method.
    try {
      const { transactionHash, uid } = await this.adapter.createAttestation(payload)
      proof = { ...proof, transactionHash, attestationUID: uid ?? null, status: 'SUBMITTED' }
      await this.store.save(proof)
      logger.info('blockchain_proof.submitted', { assetId, transactionHash, uid })

      const status = await this.adapter.waitForConfirmation(transactionHash)
      proof = { ...proof, status, timestamp: status === 'CONFIRMED' ? Date.now() : null }
      await this.store.save(proof)
      logger.info(`blockchain_proof.${status.toLowerCase()}`, { assetId, transactionHash, uid })

      return proof
    } catch (err) {
      proof = { ...proof, status: 'FAILED' }
      await this.store.save(proof)
      logger.error('blockchain_proof.failed', {
        assetId,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  /**
   * Re-analysis case: creates a new proof for `assetId` that references
   * the previous confirmed proof for `previousAssetId` via EAS's native
   * refUID — matching the append-only correction pattern (the old
   * attestation is never edited, a new one just points back at it).
   * Reuses createBlockchainProof entirely; this just resolves the refUID
   * automatically instead of making the caller fetch and pass it.
   */
  async supersedeBlockchainProof(
    assetId: string,
    previousAssetId: string,
    params: BuildAttestationPayloadParams
  ): Promise<BlockchainProof> {
    const previous = await this.store.get(previousAssetId)
    if (!previous?.attestationUID) {
      throw new Error(`Cannot supersede: no confirmed attestation found for asset "${previousAssetId}"`)
    }
    return this.createBlockchainProof(assetId, { ...params, refUID: previous.attestationUID })
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
