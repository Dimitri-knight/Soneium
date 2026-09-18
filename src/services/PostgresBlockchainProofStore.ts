import type { Pool } from 'pg'
import type { TransactionStatus } from '../blockchain/BlockchainAdapter.js'
import type { BlockchainProof } from '../models/BlockchainProof.js'
import type { BlockchainProofStore } from './BlockchainProofService.js'

interface BlockchainProofRow {
  asset_id: string
  asset_hash: string
  analysis_hash: string
  copy_score: number
  analysis_version: string
  analysis_version_hash: string
  chain_id: number
  schema_uid: string
  attestation_uid: string | null
  transaction_hash: string | null
  attester: string | null
  status: string
  // pg returns BIGINT as a string by default to avoid precision loss —
  // converted back to number in rowToProof, safe since these are
  // Date.now()-range values, nowhere near JS's safe-integer ceiling.
  timestamp: string | null
  ref_uid: string | null
  idempotency_key: string
}

function rowToProof(row: BlockchainProofRow): BlockchainProof {
  return {
    assetId: row.asset_id,
    assetHash: row.asset_hash as `0x${string}`,
    analysisHash: row.analysis_hash as `0x${string}`,
    copyScore: row.copy_score,
    analysisVersion: row.analysis_version,
    analysisVersionHash: row.analysis_version_hash as `0x${string}`,
    chainId: row.chain_id,
    schemaUID: row.schema_uid as `0x${string}`,
    attestationUID: (row.attestation_uid as `0x${string}` | null) ?? null,
    transactionHash: (row.transaction_hash as `0x${string}` | null) ?? null,
    attester: (row.attester as `0x${string}` | null) ?? null,
    status: row.status as TransactionStatus,
    timestamp: row.timestamp !== null ? Number(row.timestamp) : null,
    refUID: (row.ref_uid as `0x${string}` | null) ?? null,
    idempotencyKey: row.idempotency_key as `0x${string}`,
  }
}

/**
 * Postgres-backed BlockchainProofStore. Uses the plain `pg` driver with
 * hand-written SQL, no ORM — one table, three query shapes doesn't
 * justify the extra dependency.
 *
 * Schema: migrations/001_blockchain_proofs.sql (run it before using this).
 *
 * Covered by `npm run test:postgres` (test/integration/postgresDevnet.test.ts)
 * against a real local Postgres instance.
 */
export class PostgresBlockchainProofStore implements BlockchainProofStore {
  constructor(private readonly pool: Pool) {}

  async save(proof: BlockchainProof): Promise<void> {
    await this.pool.query(
      `INSERT INTO blockchain_proofs (
         asset_id, asset_hash, analysis_hash, copy_score, analysis_version,
         analysis_version_hash, chain_id, schema_uid, attestation_uid,
         transaction_hash, attester, status, "timestamp", ref_uid, idempotency_key,
         updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
       ON CONFLICT (asset_id) DO UPDATE SET
         asset_hash = EXCLUDED.asset_hash,
         analysis_hash = EXCLUDED.analysis_hash,
         copy_score = EXCLUDED.copy_score,
         analysis_version = EXCLUDED.analysis_version,
         analysis_version_hash = EXCLUDED.analysis_version_hash,
         chain_id = EXCLUDED.chain_id,
         schema_uid = EXCLUDED.schema_uid,
         attestation_uid = EXCLUDED.attestation_uid,
         transaction_hash = EXCLUDED.transaction_hash,
         attester = EXCLUDED.attester,
         status = EXCLUDED.status,
         "timestamp" = EXCLUDED."timestamp",
         ref_uid = EXCLUDED.ref_uid,
         idempotency_key = EXCLUDED.idempotency_key,
         updated_at = now()`,
      [
        proof.assetId,
        proof.assetHash,
        proof.analysisHash,
        proof.copyScore,
        proof.analysisVersion,
        proof.analysisVersionHash,
        proof.chainId,
        proof.schemaUID,
        proof.attestationUID,
        proof.transactionHash,
        proof.attester,
        proof.status,
        proof.timestamp,
        proof.refUID,
        proof.idempotencyKey,
      ]
    )
  }

  async get(assetId: string): Promise<BlockchainProof | null> {
    const result = await this.pool.query<BlockchainProofRow>(
      'SELECT * FROM blockchain_proofs WHERE asset_id = $1',
      [assetId]
    )
    return result.rows[0] ? rowToProof(result.rows[0]) : null
  }

  /**
   * Looked up by BlockchainProofService before attesting, to dedupe
   * repeated requests for identical content. Note: idempotency_key has
   * only a plain index, not a UNIQUE constraint, so this alone doesn't
   * prevent a race between concurrent callers across multiple process
   * instances — BlockchainProofService only guards against that within a
   * single process (in-flight-promise map). A multi-instance deployment
   * sharing this store would need a DB-level uniqueness guarantee too.
   */
  async findByIdempotencyKey(key: `0x${string}`): Promise<BlockchainProof | null> {
    const result = await this.pool.query<BlockchainProofRow>(
      'SELECT * FROM blockchain_proofs WHERE idempotency_key = $1 ORDER BY created_at DESC LIMIT 1',
      [key]
    )
    return result.rows[0] ? rowToProof(result.rows[0]) : null
  }

  /**
   * Not part of BlockchainProofStore — for a future sync/reconciliation
   * job to find everything still in flight. Not wired into anything yet.
   */
  async findByStatus(status: TransactionStatus): Promise<BlockchainProof[]> {
    const result = await this.pool.query<BlockchainProofRow>(
      'SELECT * FROM blockchain_proofs WHERE status = $1 ORDER BY created_at ASC',
      [status]
    )
    return result.rows.map(rowToProof)
  }
}
