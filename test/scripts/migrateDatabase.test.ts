import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyMigrations } from '../../scripts/migrateDatabase.js'
import type { MigrationClient } from '../../scripts/migrateDatabase.js'

/**
 * applyMigrations reads real .sql files off disk (readdirSync/readFileSync
 * against the passed-in migrationsDir), so these tests use real, disposable
 * temp directories rather than mocking the filesystem — the fake piece is
 * the Postgres client (`query`), same mocking style already used in
 * PostgresBlockchainProofStore.test.ts. No real database is touched.
 */
function fakeClient(queryImpl?: (sql: string) => Promise<unknown>): MigrationClient & { query: ReturnType<typeof vi.fn> } {
  return { query: vi.fn(queryImpl ?? (async () => undefined)) }
}

describe('applyMigrations', () => {
  let dir: string | undefined

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
      dir = undefined
    }
  })

  it('applies multiple .sql files in sorted filename order, wrapped in BEGIN/COMMIT', async () => {
    dir = mkdtempSync(join(tmpdir(), 'migrate-test-'))
    writeFileSync(join(dir, '002_second.sql'), 'CREATE TABLE second ();')
    writeFileSync(join(dir, '001_first.sql'), 'CREATE TABLE first ();')

    const calls: string[] = []
    const client = fakeClient(async (sql) => {
      calls.push(sql)
    })

    const count = await applyMigrations(client, dir)

    expect(count).toBe(2)
    expect(calls).toEqual(['BEGIN', 'CREATE TABLE first ();', 'CREATE TABLE second ();', 'COMMIT'])
  })

  it('ignores non-.sql files in the migrations directory', async () => {
    dir = mkdtempSync(join(tmpdir(), 'migrate-test-'))
    writeFileSync(join(dir, '001_first.sql'), 'CREATE TABLE first ();')
    writeFileSync(join(dir, 'README.md'), '# not a migration')
    writeFileSync(join(dir, 'notes.txt'), 'not sql either')

    const calls: string[] = []
    const client = fakeClient(async (sql) => {
      calls.push(sql)
    })

    const count = await applyMigrations(client, dir)

    expect(count).toBe(1)
    expect(calls).toEqual(['BEGIN', 'CREATE TABLE first ();', 'COMMIT'])
  })

  it('rolls back and rethrows the original error when a migration file fails', async () => {
    dir = mkdtempSync(join(tmpdir(), 'migrate-test-'))
    writeFileSync(join(dir, '001_first.sql'), 'CREATE TABLE first ();')
    writeFileSync(join(dir, '002_second.sql'), 'BROKEN SQL')

    const calls: string[] = []
    const failure = new Error('syntax error at BROKEN SQL')
    const client = fakeClient(async (sql) => {
      calls.push(sql)
      if (sql === 'BROKEN SQL') throw failure
    })

    await expect(applyMigrations(client, dir)).rejects.toThrow(failure)
    expect(calls).toEqual(['BEGIN', 'CREATE TABLE first ();', 'BROKEN SQL', 'ROLLBACK'])
  })

  it('returns 0 and never opens a transaction when no .sql files are found', async () => {
    dir = mkdtempSync(join(tmpdir(), 'migrate-test-'))
    writeFileSync(join(dir, 'README.md'), '# empty migrations dir, nothing to apply')

    const client = fakeClient()
    const count = await applyMigrations(client, dir)

    expect(count).toBe(0)
    expect(client.query).not.toHaveBeenCalled()
  })
})
