import { buildAttestationPayload, type BuildAttestationPayloadParams } from '../core/attestation/AttestationBuilder.js'
import { logger } from '../core/logging/logger.js'
import { classifyError } from '../core/logging/errorClassification.js'
import { computeIdempotencyKey, recoverStuckAttestation } from '../blockchain/transactions/TransactionManager.js'
import type { AttestationInput, BlockchainAdapter, TransactionStatus } from '../blockchain/BlockchainAdapter.js'
import type { BlockchainProof } from '../models/BlockchainProof.js'

/** Persistence seam — swap for a real DB-backed implementation. Adds findByIdempotencyKey alongside the basic get/save. */
export interface BlockchainProofStore {
  save(proof: BlockchainProof): Promise<void>
  get(assetId: string): Promise<BlockchainProof | null>
  findByIdempotencyKey(key: `0x${string}`): Promise<BlockchainProof | null>
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

  async findByIdempotencyKey(key: `0x${string}`): Promise<BlockchainProof | null> {
    for (const proof of this.records.values()) {
      if (proof.idempotencyKey === key) return proof
    }
    return null
  }
}

/**
 * Orchestration layer between CopySight's own analysis pipeline and the
 * blockchain module. Depends only on BlockchainAdapter and
 * BlockchainProofStore — never on Soneium/EAS specifics or a concrete
 * database — so it's fully testable with fakes for both.
 *
 * createBlockchainProof() blocks until the transaction is CONFIRMED (or
 * reconciled — see below) before returning, rather than returning
 * immediately as PENDING and updating status via a background job later.
 * Simpler at this volume; revisit if a non-blocking UX is needed.
 */
export class BlockchainProofService {
  /**
   * Guards the idempotency check-then-act race: two concurrent
   * createBlockchainProof() calls for the same (tenant, assetHash,
   * analysisVersionHash, schemaUID) key would otherwise both see
   * findByIdempotencyKey() return null before either has saved, and both
   * attest on-chain for identical content. Keying the in-flight promise
   * by idempotencyKey serializes those calls within this process. This
   * doesn't protect a multi-instance deployment sharing one Postgres
   * store — that needs a DB-level uniqueness guarantee (see the note on
   * PostgresBlockchainProofStore.findByIdempotencyKey).
   */
  private readonly inFlightByIdempotencyKey = new Map<`0x${string}`, Promise<BlockchainProof>>()

  constructor(
    private readonly adapter: BlockchainAdapter,
    private readonly store: BlockchainProofStore,
    private readonly chainId: number,
    private readonly schemaUID: `0x${string}`,
    private readonly tenant: string = 'copysight'
  ) {}

  async createBlockchainProof(
    assetId: string,
    params: BuildAttestationPayloadParams
  ): Promise<BlockchainProof> {
    const payload = buildAttestationPayload(params)

    const idempotencyKey = computeIdempotencyKey({
      tenant: this.tenant,
      assetHash: payload.assetHash,
      analysisVersionHash: payload.analysisVersionHash,
      schemaUID: this.schemaUID,
    })

    const inFlight = this.inFlightByIdempotencyKey.get(idempotencyKey)
    if (inFlight) {
      logger.info('blockchain_proof.idempotent_wait', { assetId, idempotencyKey })
      const result = await inFlight
      return this.aliasForAssetId(result, assetId)
    }

    const task = this.attestAndPersist(assetId, idempotencyKey, payload, params)
    this.inFlightByIdempotencyKey.set(idempotencyKey, task)
    try {
      return await task
    } finally {
      this.inFlightByIdempotencyKey.delete(idempotencyKey)
    }
  }

  /**
   * On an idempotent hit, `proof` may be stored under a different assetId
   * than the one just requested. Persist an equivalent row under the
   * requested assetId too (without re-attesting), so a caller that only
   * looks up by assetId still finds it via getBlockchainProof().
   */
  private async aliasForAssetId(proof: BlockchainProof, assetId: string): Promise<BlockchainProof> {
    if (proof.assetId === assetId) return proof
    const aliased: BlockchainProof = { ...proof, assetId }
    await this.store.save(aliased)
    return aliased
  }

  private async attestAndPersist(
    assetId: string,
    idempotencyKey: `0x${string}`,
    payload: AttestationInput,
    params: BuildAttestationPayloadParams
  ): Promise<BlockchainProof> {
    // Same underlying content (tenant + asset + analysis version +
    // schema) already has a non-failed proof — return/alias it instead
    // of attesting again.
    const existing = await this.store.findByIdempotencyKey(idempotencyKey)
    if (existing && existing.status !== 'FAILED') {
      logger.info('blockchain_proof.idempotent_hit', {
        assetId,
        idempotencyKey,
        existingAssetId: existing.assetId,
        existingStatus: existing.status,
      })
      return this.aliasForAssetId(existing, assetId)
    }

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
      idempotencyKey,
    }
    await this.store.save(proof)
    logger.info('blockchain_proof.pending', { assetId, assetHash: payload.assetHash, idempotencyKey })

    // A failure here (RPC error, reverted tx — including a resolver
    // rejection — or a timeout) means the attestation genuinely never
    // got submitted, so FAILED is correct. Kept separate from the
    // store.save() calls below since a persistence error is a different
    // kind of failure (see markFailed).
    let transactionHash: `0x${string}`
    let uid: `0x${string}` | undefined
    try {
      const submitted = await this.adapter.createAttestation(payload)
      transactionHash = submitted.transactionHash
      uid = submitted.uid
    } catch (err) {
      await this.markFailed(proof, assetId, err)
      throw err
    }

    proof = { ...proof, transactionHash, attestationUID: uid ?? null, status: 'SUBMITTED' }
    await this.store.save(proof)
    logger.info('blockchain_proof.submitted', { assetId, transactionHash, uid })

    // A thrown error here means the transaction's fate is genuinely
    // unknown, so FAILED is still right. Separate try/catch from the
    // createAttestation() one above so each phase's failure is
    // attributed correctly.
    let status: TransactionStatus
    try {
      status = await this.adapter.waitForConfirmation(transactionHash)

      if (status === 'PENDING') {
        // Timed out rather than getting a definitive answer — reconcile
        // before assuming failure, to check whether the attestation
        // actually landed and avoid a caller resubmitting and
        // double-attesting.
        const recovery = await recoverStuckAttestation(this.adapter, uid)
        logger.warn('blockchain_proof.confirmation_timeout', { assetId, transactionHash, uid, recovery })
        if (recovery === 'ALREADY_CONFIRMED') {
          status = 'CONFIRMED'
        }
        // else: still unresolved — status stays PENDING for a later
        // retry/check (no automatic same-nonce resubmission here).
      }
    } catch (err) {
      await this.markFailed(proof, assetId, err)
      throw err
    }

    // Backfill the real on-chain attester once confirmed —
    // createAttestation()'s response doesn't carry one, only a full
    // getAttestation() read does. Best-effort: a failure here doesn't
    // change the fact that the attestation itself confirmed, so it's
    // logged rather than turned into a FAILED proof.
    let attester: `0x${string}` | null = null
    if (status === 'CONFIRMED' && uid) {
      try {
        attester = (await this.adapter.getAttestation(uid))?.attester ?? null
      } catch (err) {
        logger.warn('blockchain_proof.attester_backfill_failed', { assetId, uid, ...classifyError(err) })
      }
    }

    proof = { ...proof, status, attester, timestamp: status === 'CONFIRMED' ? Date.now() : null }

    // Pure persistence after the on-chain outcome is already known — if
    // this throws, that's a store failure, not an attestation failure.
    // Not caught here: let it propagate rather than relabeling the proof
    // FAILED, which would misrepresent a successful on-chain result.
    await this.store.save(proof)
    logger.info(`blockchain_proof.${status.toLowerCase()}`, { assetId, transactionHash, uid })

    return proof
  }

  /**
   * Persists a FAILED status after a genuine adapter/network error
   * (never called for a persistence error). The save itself is
   * best-effort: if the store is also unavailable, that secondary
   * failure is logged but must not replace or swallow the original
   * error.
   */
  private async markFailed(proof: BlockchainProof, assetId: string, err: unknown): Promise<void> {
    // classifyError() distinguishes an RPC/network error from an
    // on-chain revert (e.g. CopySightResolver rejecting an unauthorized
    // attester or an invalid copyScore) from an out-of-gas failure.
    logger.error('blockchain_proof.failed', { assetId, ...classifyError(err) })
    try {
      await this.store.save({ ...proof, status: 'FAILED' })
    } catch (saveErr) {
      logger.error('blockchain_proof.failed_to_persist_failure', { assetId, ...classifyError(saveErr) })
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
    // Requires status === 'CONFIRMED', not just a non-null attestationUID:
    // attestationUID is set as soon as the transaction is SUBMITTED and
    // stays set even if it later ends up FAILED. Without this check, a
    // still-pending or failed proof could be referenced via refUID as if
    // it were confirmed.
    if (!previous || previous.status !== 'CONFIRMED' || !previous.attestationUID) {
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
