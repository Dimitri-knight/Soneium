import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SoneiumEASAdapter } from '../src/blockchain/soneium/SoneiumEASAdapter.js'
import { CONTRACTS, config } from '../src/blockchain/soneium/config.js'
import { SCHEMA_CONFIG } from '../src/schemas/CopySightAnalysisSchema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * One-time registration of the CopySight schema on Soneium Minato.
 *
 * DO NOT RUN until:
 *   1. Architect has confirmed the minimal 4-field schema (not the
 *      richer diagram version) is the real one — see
 *      src/schemas/CopySightAnalysisSchema.ts for the full note.
 *   2. The deployer/attester wallet is funded via the Minato faucet.
 * Registration is effectively irreversible — a wrong schema means
 * registering a new one and abandoning the old UID, not editing it.
 *
 * On success, records the result to deployments/minato.json (public
 * deployment facts — schemaUID, addresses — separate from .env's
 * secrets) as well as printing the value to add to .env.
 */
async function main() {
  const adapter = new SoneiumEASAdapter()
  const schemaUID = await adapter.registerSchema()

  console.log(`Schema registered. UID: ${schemaUID}`)
  console.log('Add this to .env as COPYSIGHT_SCHEMA_UID')

  const deploymentsDir = join(__dirname, '..', 'deployments')
  mkdirSync(deploymentsDir, { recursive: true })

  const record = {
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    easAddress: CONTRACTS.eas,
    schemaRegistryAddress: CONTRACTS.schemaRegistry,
    schemaUID,
    schemaName: SCHEMA_CONFIG.name,
    schema: SCHEMA_CONFIG.schema,
    revocable: SCHEMA_CONFIG.revocable,
    attesterAddress: config.attesterAddress || null,
    registeredAt: new Date().toISOString(),
  }

  const outPath = join(deploymentsDir, 'minato.json')
  writeFileSync(outPath, JSON.stringify(record, null, 2) + '\n')
  console.log(`Recorded to ${outPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
