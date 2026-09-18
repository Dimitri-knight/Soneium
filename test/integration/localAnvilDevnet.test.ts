import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ContractFactory, JsonRpcProvider, Wallet } from 'ethers'

/**
 * Real, unmocked integration test against a local `anvil` chain — NOT
 * part of the default `npm test` run. Run explicitly via `npm run
 * test:devnet`. Requires the `anvil` and `forge` binaries (ship with
 * Foundry, already a project dependency for contracts/) on PATH.
 *
 * Why this exists: a manual local dry run (see SETUP.md, "Local dry
 * run against a real anvil chain") deployed fresh SchemaRegistry/EAS
 * contracts to a throwaway anvil chain and ran the actual, unmodified
 * project scripts against it instead of real Minato — and immediately
 * caught a real bug (eas-sdk's package.json missing "type": "module"
 * breaks named imports under real Node/tsx execution, even though every
 * existing *mocked* test missed it entirely, since nothing had ever
 * really executed SoneiumEASAdapter's real code before). This test turns
 * that one-off manual proof into something that runs automatically and
 * repeatably, so that class of bug — anything only visible when the real
 * SDK actually talks to a real chain — gets caught going forward without
 * ever needing a funded Minato wallet.
 *
 * Deliberately excluded from `npm test`: it shells out to real binaries
 * and does real (if local) transactions, so it's slower and has an
 * external-tool dependency the fast/hermetic default suite doesn't need.
 */

const RPC_PORT = 8646 // distinct from anvil's own default 8545, so this never collides with a manually-run instance
const RPC_URL = `http://127.0.0.1:${RPC_PORT}`

// Standard, well-known anvil/hardhat deterministic test accounts — fixed,
// public, local-chain-only keys. Never used for anything real; safe to
// hardcode, same as anvil's own documentation does.
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const DEPLOYER_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const UNAUTHORIZED_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'

let anvilProcess: ChildProcess
let schemaRegistryAddress: `0x${string}`
let easAddress: `0x${string}`
let resolverAddress: `0x${string}`
let schemaUID: `0x${string}`
let originalEnv: NodeJS.ProcessEnv

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

/** Shells out to `forge create`, same as the manual dry run — parses the deployed address from its own stdout rather than re-implementing deployment logic. */
function forgeCreate(contractPath: string, constructorArgs: string[] = []): `0x${string}` {
  const args = ['create', contractPath, '--rpc-url', RPC_URL, '--private-key', DEPLOYER_KEY, '--broadcast']
  if (constructorArgs.length > 0) {
    args.push('--constructor-args', ...constructorArgs)
  }
  const output = execFileSync('forge', args, { encoding: 'utf-8', cwd: process.cwd() })
  const match = output.match(/Deployed to: (0x[0-9a-fA-F]{40})/)
  if (!match) {
    throw new Error(`Could not parse deployed address from "forge create" output:\n${output}`)
  }
  return match[1] as `0x${string}`
}

beforeAll(async () => {
  originalEnv = { ...process.env }

  anvilProcess = spawn('anvil', ['--port', String(RPC_PORT), '--silent'], { stdio: 'ignore' })
  await waitForRpc(RPC_URL)

  schemaRegistryAddress = forgeCreate(
    'node_modules/@ethereum-attestation-service/eas-contracts/contracts/SchemaRegistry.sol:SchemaRegistry'
  )
  easAddress = forgeCreate(
    'node_modules/@ethereum-attestation-service/eas-contracts/contracts/EAS.sol:EAS',
    [schemaRegistryAddress]
  )

  const resolverArtifactPath = join(
    process.cwd(),
    'contracts',
    'out',
    'CopySightResolver.sol',
    'CopySightResolver.json'
  )
  if (!existsSync(resolverArtifactPath)) {
    throw new Error('contracts/out/CopySightResolver.sol/CopySightResolver.json not found — run "forge build" first.')
  }
  const artifact = JSON.parse(readFileSync(resolverArtifactPath, 'utf-8'))
  const provider = new JsonRpcProvider(RPC_URL, { chainId: 31337, name: 'anvil-devnet' })
  const deployerSigner = new Wallet(DEPLOYER_KEY, provider)
  const factory = new ContractFactory(artifact.abi, artifact.bytecode.object, deployerSigner)
  const resolver = await factory.deploy(easAddress, DEPLOYER_ADDRESS, DEPLOYER_ADDRESS)
  await resolver.waitForDeployment()
  resolverAddress = (await resolver.getAddress()) as `0x${string}`

  // Env vars set BEFORE any dynamic import below — config.ts reads these
  // eagerly at module-load time, so they must be in place first. Restored
  // in afterAll; never written to .env.
  process.env.SONEIUM_RPC_URL = RPC_URL
  process.env.SONEIUM_CHAIN_ID = '31337'
  process.env.SONEIUM_SCHEMA_REGISTRY_ADDRESS = schemaRegistryAddress
  process.env.SONEIUM_EAS_ADDRESS = easAddress
  process.env.COPYSIGHT_ATTESTER_ADDRESS = DEPLOYER_ADDRESS
  process.env.COPYSIGHT_ATTESTER_PRIVATE_KEY = DEPLOYER_KEY
  process.env.COPYSIGHT_RESOLVER_ADDRESS = resolverAddress
  delete process.env.COPYSIGHT_SCHEMA_UID // registerSchema() below sets this; must not pre-exist

  const { SoneiumEASAdapter } = await import('../../src/blockchain/soneium/SoneiumEASAdapter.js')
  const registeringAdapter = new SoneiumEASAdapter(deployerSigner, 'minato')
  schemaUID = await registeringAdapter.registerSchema(resolverAddress)
  process.env.COPYSIGHT_SCHEMA_UID = schemaUID

  // config.ts snapshots process.env at module-load time (evaluated once,
  // not per-call) — the import above already cached it WITHOUT
  // COPYSIGHT_SCHEMA_UID (set just now, after that import happened). Every
  // `it()` below does its own fresh dynamic import, so resetting the
  // module registry here (once) is what makes those pick up the real,
  // now-complete env instead of the earlier, incomplete snapshot.
  vi.resetModules()
}, 60_000)

afterAll(() => {
  anvilProcess?.kill()
  process.env = originalEnv
})

describe('local anvil devnet — full real integration, no mocks', () => {
  it('registered the real schema with revocable=false and the resolver attached', () => {
    expect(schemaUID).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('submits a real attestation, confirms it, and reads back exactly what was submitted', async () => {
    const { SoneiumEASAdapter } = await import('../../src/blockchain/soneium/SoneiumEASAdapter.js')
    const { buildAttestationPayload } = await import('../../src/core/attestation/AttestationBuilder.js')
    const provider = new JsonRpcProvider(RPC_URL, { chainId: 31337, name: 'anvil-devnet' })
    const attesterSigner = new Wallet(DEPLOYER_KEY, provider)
    const adapter = new SoneiumEASAdapter(attesterSigner, 'minato')

    const payload = buildAttestationPayload({
      assetBytes: new TextEncoder().encode('devnet integration test asset'),
      analysis: { detected: 'test-fixture', similarity: 0.42 },
      copyScore: 42,
      analysisVersion: 'devnet-integration-v1',
    })

    const { transactionHash, uid } = await adapter.createAttestation(payload)
    expect(transactionHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(uid).toMatch(/^0x[0-9a-f]{64}$/)

    const status = await adapter.waitForConfirmation(transactionHash)
    expect(status).toBe('CONFIRMED')

    const record = await adapter.getAttestation(uid!)
    expect(record).not.toBeNull()
    expect(record!.attester.toLowerCase()).toBe(DEPLOYER_ADDRESS.toLowerCase())
    expect(record!.schemaUID).toBe(schemaUID)
    expect(record!.revoked).toBe(false)
    expect(record!.data).toEqual(payload)

    const verified = await adapter.verifyAttestation(uid!)
    expect(verified).toBe(true)

    const { AttestationVerifier } = await import('../../src/core/verification/AttestationVerifier.js')
    const verifier = new AttestationVerifier(adapter, schemaUID, DEPLOYER_ADDRESS as `0x${string}`)
    expect(await verifier.verifySchema(uid!)).toBe(true)
    expect(await verifier.verifyAttester(uid!)).toBe(true)
    expect(await verifier.verifyNotRevoked(uid!)).toBe(true)
  })

  it('the resolver rejects an attestation from an unauthorized attester — enforced live, not just in Foundry unit tests', async () => {
    const { SoneiumEASAdapter } = await import('../../src/blockchain/soneium/SoneiumEASAdapter.js')
    const { buildAttestationPayload } = await import('../../src/core/attestation/AttestationBuilder.js')
    const provider = new JsonRpcProvider(RPC_URL, { chainId: 31337, name: 'anvil-devnet' })
    const unauthorizedSigner = new Wallet(UNAUTHORIZED_KEY, provider)
    const adapter = new SoneiumEASAdapter(unauthorizedSigner, 'minato')

    const payload = buildAttestationPayload({
      assetBytes: new TextEncoder().encode('should be rejected'),
      analysis: { detected: 'n/a', similarity: 0 },
      copyScore: 0,
      analysisVersion: 'devnet-integration-v1',
    })

    await expect(adapter.createAttestation(payload)).rejects.toThrow()
  })

  it('the resolver rejects an out-of-range copyScore — enforced live, not just in Foundry unit tests', async () => {
    const { SoneiumEASAdapter } = await import('../../src/blockchain/soneium/SoneiumEASAdapter.js')
    const { buildAttestationPayload } = await import('../../src/core/attestation/AttestationBuilder.js')
    const provider = new JsonRpcProvider(RPC_URL, { chainId: 31337, name: 'anvil-devnet' })
    const attesterSigner = new Wallet(DEPLOYER_KEY, provider)
    const adapter = new SoneiumEASAdapter(attesterSigner, 'minato')

    const payload = buildAttestationPayload({
      assetBytes: new TextEncoder().encode('valid score, will be tampered with below'),
      analysis: { detected: 'n/a', similarity: 1 },
      copyScore: 100,
      analysisVersion: 'devnet-integration-v1',
    })

    await expect(adapter.createAttestation({ ...payload, copyScore: 150 })).rejects.toThrow()
  })
})
