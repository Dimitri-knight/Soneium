import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface MigrationClient {
  query: (sql: string) => Promise<unknown>
}

/**
 * Applies every .sql file in `migrationsDir`, in filename order, inside a
 * single transaction. Extracted from main() so it's unit-testable with a
 * fake client, without a live Postgres connection.
 *
 * Returns the number of files applied (0 if none found).
 */
export async function applyMigrations(client: MigrationClient, migrationsDir: string): Promise<number> {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  if (files.length === 0) {
    console.log('No migration files found in /migrations.')
    return 0
  }

  try {
    await client.query('BEGIN')
    for (const file of files) {
      console.log(`Applying ${file}...`)
      const sql = readFileSync(join(migrationsDir, file), 'utf-8')
      await client.query(sql)
    }
    await client.query('COMMIT')
    console.log(`Applied ${files.length} migration file(s).`)
    return files.length
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  }
}

/**
 * Applies every .sql file in /migrations, in filename order, inside a
 * single transaction. No tracking table yet — the one migration file
 * uses IF NOT EXISTS throughout, so it's safe to re-run. Worth a real
 * migration tool once there's more schema churn.
 */
async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set.')
  }

  const migrationsDir = join(__dirname, '..', 'migrations')

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const client = await pool.connect()

  try {
    await applyMigrations(client, migrationsDir)
  } finally {
    client.release()
    await pool.end()
  }
}

// Guarded so this module can be imported (e.g. by tests, for
// applyMigrations) without attempting a live Postgres connection.
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
