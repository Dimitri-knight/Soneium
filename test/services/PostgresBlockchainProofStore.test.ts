import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { PostgresBlockchainProofStore } from '../../src/services/PostgresBlockchainProofStore.js'
import type { BlockchainProof } from '../../src/models/BlockchainProof.js'

/**
 * No live Postgres in this environment, so these use a mocked Pool to
 * cover the row<->BlockchainProof mapping and the SQL/param shape sent
 * to the driver. They don't cover Postgres actually accepting the SQL —
 * see test/integration/postgresDevnet.test.ts for that.
 */
function mockPool(queryImpl: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>): Pool {
  return { query: vi.fn(queryImpl) } as unknown as Pool
}

const sampleProof: BlockchainProof = {
  assetId: 'asset-1',
  assetHash: '0x1111111111111111111111111111111111111111111111111111111111111a',
  analysisHash: '0x2222222222222222222222222222222222222222222222222222222222222b',
  copyScore: 87,
  analysisVersion: 'v1.0.0',
  analysisVersionHash: '0x3333333333333333333333333333333333333333333333333333333333333c',
  chainId: 1946,
  schemaUID: '0x4444444444444444444444444444444444444444444444444444444444444d',
  attestationUID: '0x5555555555555555555555555555555555555555555555555555555555555e',
  transactionHash: '0x6666666666666666666666666666666666666666666666666666666666666f',
  attester: '0x000000000000000000000000000000000000aa',
  status: 'CONFIRMED',
  timestamp: 1735689600000,
  refUID: null,
  idempotencyKey: '0x7777777777777777777777777777777777777777777777777777777777777f',
}

const sampleRow = {
  asset_id: sampleProof.assetId,
  asset_hash: sampleProof.assetHash,
  analysis_hash: sampleProof.analysisHash,
  copy_score: sampleProof.copyScore,
  analysis_version: sampleProof.analysisVersion,
  analysis_version_hash: sampleProof.analysisVersionHash,
  chain_id: sampleProof.chainId,
  schema_uid: sampleProof.schemaUID,
  attestation_uid: sampleProof.attestationUID,
  transaction_hash: sampleProof.transactionHash,
  attester: sampleProof.attester,
  status: sampleProof.status,
  timestamp: String(sampleProof.timestamp), // pg returns BIGINT columns as strings
  ref_uid: sampleProof.refUID,
  idempotency_key: sampleProof.idempotencyKey,
}

describe('PostgresBlockchainProofStore', () => {
  it('save() sends an INSERT ... ON CONFLICT with all 15 fields in the order the SQL expects', async () => {
    let capturedParams: unknown[] | undefined
    const pool = mockPool(async (sql, params) => {
      expect(sql).toMatch(/INSERT INTO blockchain_proofs/)
      expect(sql).toMatch(/ON CONFLICT \(asset_id\) DO UPDATE/)
      capturedParams = params
      return { rows: [] }
    })

    await new PostgresBlockchainProofStore(pool).save(sampleProof)

    expect(capturedParams).toEqual([
      sampleProof.assetId,
      sampleProof.assetHash,
      sampleProof.analysisHash,
      sampleProof.copyScore,
      sampleProof.analysisVersion,
      sampleProof.analysisVersionHash,
      sampleProof.chainId,
      sampleProof.schemaUID,
      sampleProof.attestationUID,
      sampleProof.transactionHash,
      sampleProof.attester,
      sampleProof.status,
      sampleProof.timestamp,
      sampleProof.refUID,
      sampleProof.idempotencyKey,
    ])
  })

  it('get() maps a returned row back to a BlockchainProof, converting the stringified BIGINT timestamp to a number', async () => {
    const pool = mockPool(async () => ({ rows: [sampleRow] }))
    const result = await new PostgresBlockchainProofStore(pool).get('asset-1')

    expect(result).toEqual(sampleProof)
    expect(typeof result?.timestamp).toBe('number')
  })

  it('get() returns null when no row is found, not an empty object', async () => {
    const pool = mockPool(async () => ({ rows: [] }))
    const result = await new PostgresBlockchainProofStore(pool).get('never-created')
    expect(result).toBeNull()
  })

  it('get() correctly maps a null timestamp (still PENDING, never confirmed)', async () => {
    const pool = mockPool(async () => ({ rows: [{ ...sampleRow, timestamp: null, status: 'PENDING' }] }))
    const result = await new PostgresBlockchainProofStore(pool).get('asset-1')
    expect(result?.timestamp).toBeNull()
    expect(result?.status).toBe('PENDING')
  })

  it('findByIdempotencyKey() queries by the key column and orders by most recent', async () => {
    let capturedSql = ''
    const pool = mockPool(async (sql) => {
      capturedSql = sql
      return { rows: [sampleRow] }
    })
    const result = await new PostgresBlockchainProofStore(pool).findByIdempotencyKey(sampleProof.idempotencyKey)

    expect(capturedSql).toMatch(/WHERE idempotency_key = \$1/)
    expect(capturedSql).toMatch(/ORDER BY created_at DESC/)
    expect(result).toEqual(sampleProof)
  })

  it('findByIdempotencyKey() returns null when no row is found, not an empty object', async () => {
    const pool = mockPool(async () => ({ rows: [] }))
    const result = await new PostgresBlockchainProofStore(pool).findByIdempotencyKey(sampleProof.idempotencyKey)
    expect(result).toBeNull()
  })

  it('findByStatus() maps every row in the result set', async () => {
    const secondRow = { ...sampleRow, asset_id: 'asset-2' }
    const pool = mockPool(async () => ({ rows: [sampleRow, secondRow] }))
    const results = await new PostgresBlockchainProofStore(pool).findByStatus('CONFIRMED')

    expect(results).toHaveLength(2)
    expect(results.map((r) => r.assetId)).toEqual(['asset-1', 'asset-2'])
  })

  it('findByStatus() returns an empty array, not throwing, when no proofs are in that status', async () => {
    const pool = mockPool(async () => ({ rows: [] }))
    const results = await new PostgresBlockchainProofStore(pool).findByStatus('PENDING')
    expect(results).toEqual([])
  })
})
