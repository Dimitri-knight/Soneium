import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import 'dotenv/config'
import { ContractFactory, Contract, NonceManager, Wallet, JsonRpcProvider } from 'ethers'

/**
 * Stands up a local anvil chain with every contract this project needs
 * already deployed and wired, then points the real .env at it — so
 * `npm run demo:web` has something real to talk to without a funded
 * Minato wallet. Not part of the production module; for local demos
 * and recordings only, same spirit as the rest of demo/.
 *
 * Deliberately always deploys fresh rather than checking for an
 * existing deployment first (unlike scripts/deploy*.ts) — anvil itself
 * resets every time it's restarted, so there's never real state here
 * worth protecting from being overwritten.
 */

const RPC_URL = 'http://127.0.0.1:8545/'
const CHAIN_ID = 31337
// Anvil's deterministic account #0 — public, local-chain-only key, safe
// to hardcode. Acts as deployer, owner, backend attester, and the one
// authorized royalty submitter all at once — this is local demo tooling
// with one operator, not a real multi-key deployment.
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const DEPLOYER_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

const ENV_PATH = join(process.cwd(), '.env')

function loadArtifact(relativePath: string) {
  const path = join(process.cwd(), 'contracts', 'out', relativePath)
  if (!existsSync(path)) {
    throw new Error(`${path} not found — run "forge build" inside contracts/ first.`)
  }
  return JSON.parse(readFileSync(path, 'utf-8'))
}

async function waitForRpc(url: string, timeoutMs = 15_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
      })
      if (res.ok) return
    } catch {
      // not up yet — keep polling
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`anvil did not become ready at ${url} within ${timeoutMs}ms`)
}

/** Pure: replaces each KEY= line that already exists in the file, appends anything that doesn't. Never touches a line whose key isn't in `updates` — real secrets like COPYSIGHT_API_KEY pass through untouched. */
export function upsertEnvVars(envContent: string, updates: Record<string, string>): string {
  const lines = envContent.split('\n')
  const remaining = new Map(Object.entries(updates))

  const updatedLines = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/)
    if (match && remaining.has(match[1])) {
      const key = match[1]
      const value = remaining.get(key)!
      remaining.delete(key)
      return `${key}=${value}`
    }
    return line
  })

  if (remaining.size > 0) {
    if (updatedLines[updatedLines.length - 1] !== '') updatedLines.push('')
    updatedLines.push('# --- Local devnet overrides (demo/startLocalDevnet.ts) ---')
    for (const [key, value] of remaining) {
      updatedLines.push(`${key}=${value}`)
    }
  }

  return updatedLines.join('\n')
}

async function main() {
  console.log('Starting anvil on :8545...')
  const anvil = spawn('anvil', ['--port', '8545'], { stdio: 'ignore', detached: true })
  anvil.unref()
  await waitForRpc(RPC_URL)
  console.log(`anvil running (pid ${anvil.pid})`)

  // cacheTimeout: -1 disables ethers' short-lived provider result cache,
  // and NonceManager avoids races between the several sequential
  // transactions below — both proven necessary against a fast, locally-
  // instant-mining anvil chain (see test/integration/localAnvilDevnet.test.ts
  // for the same fix, found the same way: reproduced, not assumed).
  const provider = new JsonRpcProvider(RPC_URL, CHAIN_ID, { cacheTimeout: -1 })
  const deployer = new NonceManager(new Wallet(DEPLOYER_KEY, provider))

  const schemaRegistryArtifact = loadArtifact('SchemaRegistry.sol/SchemaRegistry.json')
  const easArtifact = loadArtifact('EAS.sol/EAS.json')
  const resolverArtifact = loadArtifact('CopySightResolver.sol/CopySightResolver.json')
  const rightsRegistryArtifact = loadArtifact('RightsRegistry.sol/RightsRegistry.json')
  const royaltySettlementArtifact = loadArtifact('RoyaltySettlement.sol/RoyaltySettlement.json')

  console.log('Deploying SchemaRegistry + EAS...')
  const schemaRegistry = await new ContractFactory(schemaRegistryArtifact.abi, schemaRegistryArtifact.bytecode.object, deployer).deploy()
  await schemaRegistry.waitForDeployment()
  const schemaRegistryAddress = await schemaRegistry.getAddress()

  const eas = await new ContractFactory(easArtifact.abi, easArtifact.bytecode.object, deployer).deploy(schemaRegistryAddress)
  await eas.waitForDeployment()
  const easAddress = await eas.getAddress()

  console.log('Deploying CopySightResolver...')
  const resolver = await new ContractFactory(resolverArtifact.abi, resolverArtifact.bytecode.object, deployer).deploy(
    easAddress,
    DEPLOYER_ADDRESS,
    DEPLOYER_ADDRESS
  )
  await resolver.waitForDeployment()
  const resolverAddress = (await resolver.getAddress()) as `0x${string}`

  // Must be set before the dynamic import below: config.ts reads these
  // eagerly at module-load time, same reasoning as the devnet test.
  process.env.SONEIUM_RPC_URL = RPC_URL
  process.env.SONEIUM_CHAIN_ID = String(CHAIN_ID)
  process.env.SONEIUM_SCHEMA_REGISTRY_ADDRESS = schemaRegistryAddress
  process.env.SONEIUM_EAS_ADDRESS = easAddress
  process.env.COPYSIGHT_ATTESTER_ADDRESS = DEPLOYER_ADDRESS
  process.env.COPYSIGHT_ATTESTER_PRIVATE_KEY = DEPLOYER_KEY
  process.env.COPYSIGHT_RESOLVER_ADDRESS = resolverAddress
  delete process.env.COPYSIGHT_SCHEMA_UID

  console.log('Registering the CopySight schema...')
  const { SoneiumEASAdapter } = await import('../src/blockchain/soneium/SoneiumEASAdapter.js')
  const registeringAdapter = new SoneiumEASAdapter(deployer, 'minato')
  const schemaUID = await registeringAdapter.registerSchema(resolverAddress)
  process.env.COPYSIGHT_SCHEMA_UID = schemaUID

  console.log('Deploying RightsRegistry + RoyaltySettlement...')
  const registry = await new ContractFactory(rightsRegistryArtifact.abi, rightsRegistryArtifact.bytecode.object, deployer).deploy(
    DEPLOYER_ADDRESS
  )
  await registry.waitForDeployment()
  const rightsRegistryAddress = await registry.getAddress()

  const settlement = await new ContractFactory(
    royaltySettlementArtifact.abi,
    royaltySettlementArtifact.bytecode.object,
    deployer
  ).deploy(easAddress, rightsRegistryAddress, schemaUID, DEPLOYER_ADDRESS)
  await settlement.waitForDeployment()
  const royaltySettlementAddress = await settlement.getAddress()

  console.log('Wiring authorizations...')
  const registryContract = new Contract(rightsRegistryAddress, rightsRegistryArtifact.abi, deployer)
  await (await registryContract.authorizeCaller(royaltySettlementAddress)).wait()
  const resolverContract = new Contract(resolverAddress, resolverArtifact.abi, deployer)
  await (await resolverContract.authorizeAttester(royaltySettlementAddress)).wait()
  const settlementContract = new Contract(royaltySettlementAddress, royaltySettlementArtifact.abi, deployer)
  await (await settlementContract.authorizeSubmitter(DEPLOYER_ADDRESS)).wait()

  console.log('Updating .env (backing up the current one first)...')
  const backupPath = `${ENV_PATH}.backup-${Date.now()}`
  copyFileSync(ENV_PATH, backupPath)
  const existingEnv = readFileSync(ENV_PATH, 'utf-8')
  const updatedEnv = upsertEnvVars(existingEnv, {
    SONEIUM_RPC_URL: RPC_URL,
    SONEIUM_CHAIN_ID: String(CHAIN_ID),
    SONEIUM_SCHEMA_REGISTRY_ADDRESS: schemaRegistryAddress,
    SONEIUM_EAS_ADDRESS: easAddress,
    COPYSIGHT_ATTESTER_ADDRESS: DEPLOYER_ADDRESS,
    COPYSIGHT_ATTESTER_PRIVATE_KEY: DEPLOYER_KEY,
    COPYSIGHT_RESOLVER_ADDRESS: resolverAddress,
    COPYSIGHT_SCHEMA_UID: schemaUID,
    COPYSIGHT_RIGHTS_REGISTRY_ADDRESS: rightsRegistryAddress,
    COPYSIGHT_ROYALTY_SETTLEMENT_ADDRESS: royaltySettlementAddress,
  })
  writeFileSync(ENV_PATH, updatedEnv)
  console.log(`.env updated (previous version backed up to ${backupPath})`)

  console.log('\nDone. Local devnet is live:')
  console.log(`  anvil pid:         ${anvil.pid}  (stop later with: taskkill //PID ${anvil.pid} //F)`)
  console.log(`  resolver:          ${resolverAddress}`)
  console.log(`  schemaUID:         ${schemaUID}`)
  console.log(`  rightsRegistry:    ${rightsRegistryAddress}`)
  console.log(`  royaltySettlement: ${royaltySettlementAddress}`)
  console.log('\nNow run: npm run demo:web')
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
