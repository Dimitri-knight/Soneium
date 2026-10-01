import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ContractFactory, Contract } from 'ethers'
import { EnvSignerService } from '../src/blockchain/signing/SignerService.js'
import { CONTRACTS, config } from '../src/blockchain/soneium/config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface RoyaltyDeployPreconditionsInput {
  attesterAddress: string
  resolverAddress: string
  schemaUID: string
  rightsRegistryArtifactExists: boolean
  royaltySettlementArtifactExists: boolean
  resolverArtifactExists: boolean
  existingRoyaltySettlementAddress: string
  force: boolean
}

export interface RoyaltyDeployPreconditionsResult {
  ok: boolean
  errors: string[]
}

/**
 * Pure precondition checks, extracted from main() so they're
 * unit-testable without touching the filesystem or a live network.
 *
 * Needs the resolver already deployed (RoyaltySettlement gets added as
 * an authorized attester on it) and the schema already registered
 * (RoyaltySettlement's constructor is bound to one schemaUID). Refuses
 * to redeploy over an existing RoyaltySettlement unless forced, same
 * reasoning as deployCopySightResolver.ts: nothing re-points an already-
 * authorized caller/attester relationship at a new contract address
 * automatically.
 */
export function validateRoyaltyDeployPreconditions(input: RoyaltyDeployPreconditionsInput): RoyaltyDeployPreconditionsResult {
  const errors: string[] = []

  if (!input.rightsRegistryArtifactExists || !input.royaltySettlementArtifactExists || !input.resolverArtifactExists) {
    errors.push('Compiled artifact not found for RightsRegistry, RoyaltySettlement, and/or CopySightResolver. Run "forge build" first.')
  }
  if (!input.attesterAddress) {
    errors.push('COPYSIGHT_ATTESTER_ADDRESS is not set — needed as the deployer/owner of the new contracts, and as the authorized submitter on RoyaltySettlement.')
  }
  if (!input.resolverAddress) {
    errors.push('COPYSIGHT_RESOLVER_ADDRESS is not set — deploy the resolver first (deploy:resolver).')
  }
  if (!input.schemaUID) {
    errors.push('COPYSIGHT_SCHEMA_UID is not set — register the schema first (register:schema).')
  }
  if (input.existingRoyaltySettlementAddress && !input.force) {
    errors.push(
      `COPYSIGHT_ROYALTY_SETTLEMENT_ADDRESS is already set to ${input.existingRoyaltySettlementAddress} — refusing to deploy a replacement. Set COPYSIGHT_ROYALTY_DEPLOY_FORCE=true if you really mean to.`
    )
  }

  return { ok: errors.length === 0, errors }
}

/** Pure: whether to deploy a fresh RightsRegistry, or reuse one that's already configured (e.g. redeploying only a fixed RoyaltySettlement without orphaning existing creators' rights records). */
export function shouldDeployNewRightsRegistry(existingRightsRegistryAddress: string): boolean {
  return !existingRightsRegistryAddress
}

export interface RoyaltyDeploymentFields {
  rightsRegistryAddress: string
  royaltySettlementAddress: string
  royaltyOwner: string
  royaltySubmitter: string
  royaltyDeployedAt: string
}

/** Pure merge into any existing deployments/minato.json record, same pattern as the other deploy scripts. */
export function buildRoyaltyDeploymentRecord(
  existing: Record<string, unknown>,
  fields: RoyaltyDeploymentFields
): Record<string, unknown> {
  return {
    ...existing,
    rightsRegistryAddress: fields.rightsRegistryAddress,
    royaltySettlementAddress: fields.royaltySettlementAddress,
    royaltyOwner: fields.royaltyOwner,
    royaltySubmitter: fields.royaltySubmitter,
    royaltyDeployedAt: fields.royaltyDeployedAt,
  }
}

/**
 * One-time deployment of RightsRegistry.sol and RoyaltySettlement.sol,
 * wiring both into the existing, unmodified CopySightResolver — the
 * royalty feature is entirely additive. Must run after deploy:resolver
 * and register:schema. Requires a funded deployer wallet.
 *
 * The deployer's own address (config.attesterAddress) is authorized as
 * RoyaltySettlement's one trusted submitter — payAndRegister is only
 * callable by an owner-authorized backend key, never by arbitrary
 * callers, since RoyaltySettlement is itself a resolver-authorized
 * attester (see RoyaltySettlement.sol's own doc comment for why).
 */
async function main() {
  const rightsRegistryArtifactPath = join(__dirname, '..', 'contracts', 'out', 'RightsRegistry.sol', 'RightsRegistry.json')
  const royaltySettlementArtifactPath = join(__dirname, '..', 'contracts', 'out', 'RoyaltySettlement.sol', 'RoyaltySettlement.json')
  const resolverArtifactPath = join(__dirname, '..', 'contracts', 'out', 'CopySightResolver.sol', 'CopySightResolver.json')

  const preconditions = validateRoyaltyDeployPreconditions({
    attesterAddress: config.attesterAddress,
    resolverAddress: config.resolverAddress,
    schemaUID: config.schemaUID,
    rightsRegistryArtifactExists: existsSync(rightsRegistryArtifactPath),
    royaltySettlementArtifactExists: existsSync(royaltySettlementArtifactPath),
    resolverArtifactExists: existsSync(resolverArtifactPath),
    existingRoyaltySettlementAddress: config.royaltySettlementAddress,
    force: process.env.COPYSIGHT_ROYALTY_DEPLOY_FORCE === 'true',
  })
  if (!preconditions.ok) {
    for (const error of preconditions.errors) console.error(error)
    process.exit(1)
  }

  const rightsRegistryArtifact = JSON.parse(readFileSync(rightsRegistryArtifactPath, 'utf-8'))
  const royaltySettlementArtifact = JSON.parse(readFileSync(royaltySettlementArtifactPath, 'utf-8'))
  const resolverArtifact = JSON.parse(readFileSync(resolverArtifactPath, 'utf-8'))

  const signerService = new EnvSignerService()
  const signer = await signerService.getSigner('minato')
  const deployerAddress = await signer.getAddress()

  let rightsRegistryAddress: string
  if (shouldDeployNewRightsRegistry(config.rightsRegistryAddress)) {
    console.log('Deploying RightsRegistry...')
    const registryFactory = new ContractFactory(rightsRegistryArtifact.abi, rightsRegistryArtifact.bytecode.object, signer)
    const registry = await registryFactory.deploy(deployerAddress) // constructor(address initialOwner)
    await registry.waitForDeployment()
    rightsRegistryAddress = await registry.getAddress()
    console.log(`RightsRegistry deployed at: ${rightsRegistryAddress}`)
  } else {
    rightsRegistryAddress = config.rightsRegistryAddress
    console.log(`Reusing existing RightsRegistry at ${rightsRegistryAddress} (COPYSIGHT_RIGHTS_REGISTRY_ADDRESS already set) — deploying RoyaltySettlement only.`)
  }
  const registryContract = new Contract(rightsRegistryAddress, rightsRegistryArtifact.abi, signer)

  console.log('Deploying RoyaltySettlement...')
  const settlementFactory = new ContractFactory(royaltySettlementArtifact.abi, royaltySettlementArtifact.bytecode.object, signer)
  // Constructor: (IEAS eas, RightsRegistry registry, bytes32 schemaUID, address initialOwner)
  const settlement = await settlementFactory.deploy(CONTRACTS.eas, rightsRegistryAddress, config.schemaUID, deployerAddress)
  await settlement.waitForDeployment()
  const royaltySettlementAddress = await settlement.getAddress()
  console.log(`RoyaltySettlement deployed at: ${royaltySettlementAddress}`)

  console.log('Authorizing RoyaltySettlement to call RightsRegistry.registerIfClear...')
  await (await registryContract.authorizeCaller(royaltySettlementAddress)).wait()

  console.log('Authorizing RoyaltySettlement as an attester on the existing CopySightResolver (no code change to it)...')
  const resolverContract = new Contract(config.resolverAddress, resolverArtifact.abi, signer)
  await (await resolverContract.authorizeAttester(royaltySettlementAddress)).wait()

  console.log('Authorizing the backend attester key as RoyaltySettlement\'s trusted submitter...')
  const settlementContract = new Contract(royaltySettlementAddress, royaltySettlementArtifact.abi, signer)
  await (await settlementContract.authorizeSubmitter(config.attesterAddress)).wait()

  console.log('Done. Add these to .env:')
  console.log(`COPYSIGHT_RIGHTS_REGISTRY_ADDRESS=${rightsRegistryAddress}`)
  console.log(`COPYSIGHT_ROYALTY_SETTLEMENT_ADDRESS=${royaltySettlementAddress}`)

  const deploymentsDir = join(__dirname, '..', 'deployments')
  mkdirSync(deploymentsDir, { recursive: true })
  const outPath = join(deploymentsDir, 'minato.json')

  const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf-8')) : {}
  const record = buildRoyaltyDeploymentRecord(existing, {
    rightsRegistryAddress,
    royaltySettlementAddress,
    royaltyOwner: deployerAddress,
    royaltySubmitter: config.attesterAddress,
    royaltyDeployedAt: new Date().toISOString(),
  })
  writeFileSync(outPath, JSON.stringify(record, null, 2) + '\n')
  console.log(`Recorded to ${outPath}`)
}

// Guarded so this module can be imported (e.g. by tests, for
// validateRoyaltyDeployPreconditions / buildRoyaltyDeploymentRecord)
// without attempting a live deployment.
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
