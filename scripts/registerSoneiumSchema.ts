import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SoneiumEASAdapter } from '../src/blockchain/soneium/SoneiumEASAdapter.js'
import { EnvSignerService } from '../src/blockchain/signing/SignerService.js'
import { CONTRACTS, config } from '../src/blockchain/soneium/config.js'
import { SCHEMA_CONFIG } from '../src/schemas/CopySightAnalysisSchema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface SchemaDeploymentFields {
  chainId: number
  rpcUrl: string
  easAddress: string
  schemaRegistryAddress: string
  schemaUID: string
  schemaName: string
  schema: string
  revocable: boolean
  resolverAddress: string | undefined
  attesterAddress: string | null
  registeredAt: string
}

/**
 * Pure merge of a fresh registration's fields into any existing
 * deployments/minato.json record (e.g. one already written by
 * deployCopySightResolver.ts). An already-recorded resolverAddress
 * survives a run that didn't pass one. Extracted so this merge is
 * unit-testable without touching the filesystem.
 */
export function buildSchemaDeploymentRecord(
  existing: Record<string, unknown>,
  fields: SchemaDeploymentFields
): Record<string, unknown> {
  return {
    ...existing,
    chainId: fields.chainId,
    rpcUrl: fields.rpcUrl,
    easAddress: fields.easAddress,
    schemaRegistryAddress: fields.schemaRegistryAddress,
    schemaUID: fields.schemaUID,
    schemaName: fields.schemaName,
    schema: fields.schema,
    revocable: fields.revocable,
    resolverAddress: fields.resolverAddress ?? (existing.resolverAddress as string | null | undefined) ?? null,
    attesterAddress: fields.attesterAddress,
    registeredAt: fields.registeredAt,
  }
}

/**
 * One-time registration of the CopySight schema on Soneium Minato.
 * Requires a funded deployer/attester wallet, and normally
 * scripts/deployCopySightResolver.ts run first with
 * COPYSIGHT_RESOLVER_ADDRESS set — without it, this registers with the
 * zero address as resolver, a separate, permanent schemaUID. Registration
 * itself is irreversible: a wrong schema or resolver means registering a
 * new one, not editing this one.
 *
 * Records the result to deployments/minato.json (public deployment
 * facts, separate from .env's secrets), merging with any existing
 * resolver record rather than overwriting it.
 */
async function main() {
  if (config.schemaUID) {
    console.error(
      `COPYSIGHT_SCHEMA_UID is already set to ${config.schemaUID} — registration is one-way; refusing to re-register. Unset it explicitly if you really mean to register a new schema.`
    )
    process.exit(1)
  }

  const signerService = new EnvSignerService()
  const signer = await signerService.getSigner('minato')
  const adapter = new SoneiumEASAdapter(signer)

  const resolverAddress = config.resolverAddress || undefined
  console.log(
    resolverAddress
      ? `Registering with resolver: ${resolverAddress}`
      : 'Registering with NO resolver (zero address) — confirm this is intended before proceeding.'
  )

  const schemaUID = resolverAddress ? await adapter.registerSchema(resolverAddress) : await adapter.registerSchema()

  console.log(`Schema registered. UID: ${schemaUID}`)
  console.log('Add this to .env as COPYSIGHT_SCHEMA_UID')

  const deploymentsDir = join(__dirname, '..', 'deployments')
  mkdirSync(deploymentsDir, { recursive: true })
  const outPath = join(deploymentsDir, 'minato.json')

  const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf-8')) : {}
  const record = buildSchemaDeploymentRecord(existing, {
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    easAddress: CONTRACTS.eas,
    schemaRegistryAddress: CONTRACTS.schemaRegistry,
    schemaUID,
    schemaName: SCHEMA_CONFIG.name,
    schema: SCHEMA_CONFIG.schema,
    revocable: SCHEMA_CONFIG.revocable,
    resolverAddress,
    attesterAddress: config.attesterAddress || null,
    registeredAt: new Date().toISOString(),
  })

  writeFileSync(outPath, JSON.stringify(record, null, 2) + '\n')
  console.log(`Recorded to ${outPath}`)
}

// Guarded so this module can be imported (e.g. by tests, for
// buildSchemaDeploymentRecord) without attempting a live schema registration.
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
