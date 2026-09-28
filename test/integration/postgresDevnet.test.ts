import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { Pool } from 'pg'
import { applyMigrations } from '../../scripts/migrateDatabase.js'
import { PostgresBlockchainProofStore } from '../../src/services/PostgresBlockchainProofStore.js'
import type { BlockchainProof } from '../../src/models/BlockchainProof.js'

/**
 * Real, unmocked integration test against a real local Postgres — not
 * part of the default `npm test` run. Run via `npm run test:postgres`.
 * Requires a reachable `docker` daemon.
 *
 * Why: PostgresBlockchainProofStore's unit tests only ever exercised a
 * mocked Pool, so the SQL itself — the INSERT/ON CONFLICT path and the
 * BIGINT-comes-back-as-a-string-from-pg case in particular — had never
 * run against a real Postgres. This test covers that gap the same way
 * localAnvilDevnet.test.ts covers the real-chain gap.
 *
 * Excluded from `npm test` because it needs a real docker daemon and
 * starts a real (throwaway) container, which is slower.
 */

const CONTAINER_NAME = 'copysight-devnet-postgres-test'
const PG_PORT = 55433 // distinct from the manual dry run's port, so this never collides with one left running
const CONNECTION_STRING = `postgresql://postgres:devnet@127.0.0.1:${PG_PORT}/copysight`

function dockerExec(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf-8' })
}

async function waitForPostgres(pool: Pool, timeoutMs = 20_000): Promise<void> {
  const start = Date.now()
  let lastError: unknown
  while (Date.now() - start < timeoutMs) {
    try {
      await pool.query('SELECT 1')
      return
    } catch (err) {
      lastError = err
      await new Promise((r) => setTimeout(r, 300))
    }
  }
  throw new Error(`Postgres did not become ready within ${timeoutMs}ms: ${String(lastError)}`)
}

let pool: Pool

beforeAll(async () => {
  // Remove any stale container from a previous crashed/interrupted run before starting a fresh one.
  try {
    dockerExec(['rm', '-f', CONTAINER_NAME])
  } catch {
    // fine — it just didn't exist
  }

  dockerExec([
    'run', '-d', '--name', CONTAINER_NAME,
    '-e', 'POSTGRES_PASSWORD=devnet',
    '-e', 'POSTGRES_DB=copysight',
    '-p', `${PG_PORT}:5432`,
    'postgres:16-alpine',
  ])

  pool = new Pool({ connectionString: CONNECTION_STRING })
  await waitForPostgres(pool)

  const migrationsDir = join(process.cwd(), 'migrations')
  const applied = await applyMigrations(pool, migrationsDir)
  expect(applied).toBeGreaterThan(0)
}, 120_000)

afterAll(async () => {
  await pool?.end()
  try {
    dockerExec(['rm', '-f', CONTAINER_NAME])
  } catch {
    // best-effort cleanup
  }
})

describe('PostgresBlockchainProofStore — real Postgres, no mocks', () => {
  const baseProof: BlockchainProof = {
    assetId: 'devnet-asset-1',
    assetHash: `0x${'11'.repeat(32)}`,
    analysisHash: `0x${'22'.repeat(32)}`,
    copyScore: 77,
    analysisVersion: 'devnet-integration-v1',
    analysisVersionHash: `0x${'33'.repeat(32)}`,
    chainId: 1946,
    schemaUID: `0x${'44'.repeat(32)}`,
    attestationUID: null,
    transactionHash: null,
    attester: null,
    status: 'PENDING',
    timestamp: null,
    refUID: null,
    idempotencyKey: `0x${'55'.repeat(32)}`,
  }

  it('saves a new row (real INSERT) and reads it back exactly', async () => {
    const store = new PostgresBlockchainProofStore(pool)
    await store.save(baseProof)
    const got = await store.get(baseProof.assetId)
    expect(got).toEqual(baseProof)
  })

  it('finds it by idempotency key too', async () => {
    const store = new PostgresBlockchainProofStore(pool)
    const found = await store.findByIdempotencyKey(baseProof.idempotencyKey)
    expect(found?.assetId).toBe(baseProof.assetId)
  })

  it('updates the same row on a repeat save (real ON CONFLICT/UPDATE path), and a real BIGINT timestamp round-trips as a number, not a string', async () => {
    const store = new PostgresBlockchainProofStore(pool)
    const realTimestamp = Date.now() // real BIGINT-range value — this is exactly the case pg's driver returns as a string by default
    const updated: BlockchainProof = {
      ...baseProof,
      status: 'CONFIRMED',
      attestationUID: `0x${'66'.repeat(32)}`,
      transactionHash: `0x${'77'.repeat(32)}`,
      attester: `0x${'88'.repeat(20)}`,
      timestamp: realTimestamp,
    }
    await store.save(updated)

    const got = await store.get(baseProof.assetId)
    expect(got?.status).toBe('CONFIRMED')
    expect(got?.timestamp).toBe(realTimestamp)
    expect(typeof got?.timestamp).toBe('number') // NOT 'string' — the actual bug this coercion guards against
  })

  it('findByStatus finds it under its updated status', async () => {
    const store = new PostgresBlockchainProofStore(pool)
    const results = await store.findByStatus('CONFIRMED')
    expect(results.some((p) => p.assetId === baseProof.assetId)).toBe(true)
  })

  it('get() returns null for an asset that was never saved', async () => {
    const store = new PostgresBlockchainProofStore(pool)
    expect(await store.get('never-existed')).toBeNull()
  })
})
