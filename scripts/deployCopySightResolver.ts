import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ContractFactory } from 'ethers'
import { EnvSignerService } from '../src/blockchain/signing/SignerService.js'
import { CONTRACTS, config } from '../src/blockchain/soneium/config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface DeployPreconditionsInput {
  attesterAddress: string
  artifactExists: boolean
  existingResolverAddress: string
  force: boolean
}

export interface DeployPreconditionsResult {
  ok: boolean
  errors: string[]
}

/**
 * Pure precondition checks for the deploy, extracted from main() so they're
 * unit-testable without touching the filesystem or a live network.
 *
 * Refuses to run when a resolver address is already configured: EAS
 * schemaUIDs are derived from (schema, resolver, revocable), so a schema
 * registered against the old resolver won't pick up a new one automatically,
 * and re-running this by mistake would leave deployments/minato.json out of
 * sync. Set COPYSIGHT_RESOLVER_DEPLOY_FORCE=true to override for a
 * deliberate replacement.
 */
export function validateDeployPreconditions(input: DeployPreconditionsInput): DeployPreconditionsResult {
  const errors: string[] = []

  if (!input.artifactExists) {
    errors.push('Compiled artifact not found. Run "forge build" first.')
  }
  if (!input.attesterAddress) {
    errors.push("COPYSIGHT_ATTESTER_ADDRESS is not set — needed as the resolver's initial authorized attester.")
  }
  if (input.existingResolverAddress && !input.force) {
    errors.push(
      `COPYSIGHT_RESOLVER_ADDRESS is already set to ${input.existingResolverAddress} — refusing to deploy a new resolver over it. A schema already registered against the old resolver will NOT automatically pick up the new one (schemaUID is derived from (schema, resolver, revocable)). Set COPYSIGHT_RESOLVER_DEPLOY_FORCE=true if you really mean to deploy a replacement.`
    )
  }

  return { ok: errors.length === 0, errors }
}

export interface ResolverDeploymentFields {
  resolverAddress: string
  resolverOwner: string
  resolverInitialAttester: string
  resolverDeployedAt: string
}

/**
 * Pure merge of a fresh deployment's fields into any existing
 * deployments/minato.json record (e.g. one already written by
 * registerSoneiumSchema.ts), extracted so this merge is unit-testable
 * without touching the filesystem.
 */
export function buildResolverDeploymentRecord(
  existing: Record<string, unknown>,
  fields: ResolverDeploymentFields
): Record<string, unknown> {
  return {
    ...existing,
    resolverAddress: fields.resolverAddress,
    resolverOwner: fields.resolverOwner,
    resolverInitialAttester: fields.resolverInitialAttester,
    resolverDeployedAt: fields.resolverDeployedAt,
  }
}

/**
 * One-time deployment of CopySightResolver.sol to Soneium Minato. Must run
 * before scripts/registerSoneiumSchema.ts, which needs this contract's
 * address as its resolver. Requires a Minato-funded deployer wallet and a
 * fresh `forge build` (contracts/out/ must exist).
 */
async function main() {
  const artifactPath = join(
    __dirname,
    '..',
    'contracts',
    'out',
    'CopySightResolver.sol',
    'CopySightResolver.json'
  )

  const preconditions = validateDeployPreconditions({
    attesterAddress: config.attesterAddress,
    artifactExists: existsSync(artifactPath),
    existingResolverAddress: config.resolverAddress,
    force: process.env.COPYSIGHT_RESOLVER_DEPLOY_FORCE === 'true',
  })
  if (!preconditions.ok) {
    for (const error of preconditions.errors) console.error(error)
    process.exit(1)
  }

  const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'))

  const signerService = new EnvSignerService()
  const signer = await signerService.getSigner('minato')
  const deployerAddress = await signer.getAddress()

  const factory = new ContractFactory(artifact.abi, artifact.bytecode.object, signer)
  // Constructor: (IEAS eas, address initialAttester, address initialOwner)
  const resolver = await factory.deploy(CONTRACTS.eas, config.attesterAddress, deployerAddress)
  await resolver.waitForDeployment()

  const resolverAddress = await resolver.getAddress()
  console.log(`CopySightResolver deployed at: ${resolverAddress}`)
  console.log('Add this to .env as COPYSIGHT_RESOLVER_ADDRESS before running register:schema')

  const deploymentsDir = join(__dirname, '..', 'deployments')
  mkdirSync(deploymentsDir, { recursive: true })
  const outPath = join(deploymentsDir, 'minato.json')

  // Merge with any existing deployment record (e.g. from registerSoneiumSchema.ts) rather than overwrite it.
  const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf-8')) : {}
  const record = buildResolverDeploymentRecord(existing, {
    resolverAddress,
    resolverOwner: deployerAddress,
    resolverInitialAttester: config.attesterAddress,
    resolverDeployedAt: new Date().toISOString(),
  })
  writeFileSync(outPath, JSON.stringify(record, null, 2) + '\n')
  console.log(`Recorded to ${outPath}`)
}

// Guarded so this module can be imported (e.g. by tests, for
// validateDeployPreconditions / buildResolverDeploymentRecord) without
// attempting a live contract deployment.
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
