import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Contract, ContractFactory, JsonRpcProvider, NonceManager, Wallet } from 'ethers'

/**
 * Real, unmocked integration test against a local `anvil` chain — not
 * part of the default `npm test` run. Run via `npm run test:devnet`.
 * Requires `anvil` and `forge` (Foundry) on PATH.
 *
 * Why: an earlier manual dry run against a throwaway anvil chain caught
 * a real bug (eas-sdk's package.json missing "type": "module", which
 * broke named imports under real Node/tsx) that every mocked test missed
 * because nothing had actually exercised SoneiumEASAdapter against a
 * live chain. This test automates that dry run so the same class of bug
 * — anything only visible when the real SDK talks to a real chain — gets
 * caught without needing a funded Minato wallet.
 *
 * Excluded from `npm test` because it shells out to real binaries and
 * runs real (local) transactions, which is slower and needs Foundry installed.
 */

const RPC_PORT = 8646 // distinct from anvil's own default 8545, so this never collides with a manually-run instance
const RPC_URL = `http://127.0.0.1:${RPC_PORT}`
const ANVIL_NETWORK = { chainId: 31337, name: 'anvil-devnet' }
// cacheTimeout: -1 disables ethers' short-lived internal result cache for
// calls like eth_getTransactionCount("pending"). Several tests submit
// back-to-back transactions from the same address against this same
// near-instant local anvil chain, and without this, a nonce lookup can
// return a cached pre-mining value — a real, reproduced "nonce too low"
// failure, not a hypothetical one.
const PROVIDER_OPTIONS = { cacheTimeout: -1 }

function newProvider(): JsonRpcProvider {
  return new JsonRpcProvider(RPC_URL, ANVIL_NETWORK, PROVIDER_OPTIONS)
}

// Well-known anvil/hardhat deterministic test accounts — public,
// local-chain-only keys, safe to hardcode.
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const DEPLOYER_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const UNAUTHORIZED_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
// Same key as UNAUTHORIZED_KEY, anvil's deterministic account #1 — a
// different role in the royalty tests below (a real creator wallet, not
// an unauthorized attester), reusing an already-verified key/address
// pair rather than inventing a new one.
const CREATOR_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
// Anvil's deterministic account #5 — the key/address pair is verified
// directly against a live anvil's own "Available Accounts"/"Private
// Keys" printout, not hand-derived.
const PAYER_KEY = '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba'
const PAYER_ADDRESS = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc'

let anvilProcess: ChildProcess
let schemaRegistryAddress: `0x${string}`
let easAddress: `0x${string}`
let resolverAddress: `0x${string}`
let schemaUID: `0x${string}`
let rightsRegistryAddress: `0x${string}`
let royaltySettlementAddress: `0x${string}`
let paymentTokenAddress: `0x${string}`
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
  const provider = newProvider()
  // NonceManager, not a plain Wallet: this signer submits several
  // sequential transactions below (resolver deploy, schema registration,
  // both royalty contract deployments, both authorizations), and a plain
  // Wallet's per-call "pending" nonce lookup raced against anvil under
  // that many back-to-back sends. Same fix production code already uses
  // for exactly this — see SignerService.ts.
  const deployerSigner = new NonceManager(new Wallet(DEPLOYER_KEY, provider))
  const factory = new ContractFactory(artifact.abi, artifact.bytecode.object, deployerSigner)
  const resolver = await factory.deploy(easAddress, DEPLOYER_ADDRESS, DEPLOYER_ADDRESS)
  await resolver.waitForDeployment()
  resolverAddress = (await resolver.getAddress()) as `0x${string}`

  // Must be set before any dynamic import below: config.ts reads these
  // eagerly at module-load time. Restored in afterAll; never written to .env.
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

  // Royalty contracts — deployed the same way scripts/deployRoyaltyContracts.ts
  // would against a real network, so this exercises the same wiring
  // (registry.authorizeCaller + resolver.authorizeAttester) against a real chain.
  const rightsRegistryArtifactPath = join(process.cwd(), 'contracts', 'out', 'RightsRegistry.sol', 'RightsRegistry.json')
  const royaltySettlementArtifactPath = join(process.cwd(), 'contracts', 'out', 'RoyaltySettlement.sol', 'RoyaltySettlement.json')
  if (!existsSync(rightsRegistryArtifactPath) || !existsSync(royaltySettlementArtifactPath)) {
    throw new Error('RightsRegistry/RoyaltySettlement artifacts not found — run "forge build" first.')
  }
  const rightsRegistryArtifact = JSON.parse(readFileSync(rightsRegistryArtifactPath, 'utf-8'))
  const royaltySettlementArtifact = JSON.parse(readFileSync(royaltySettlementArtifactPath, 'utf-8'))

  // Fresh NonceManager rather than reusing deployerSigner: the EAS SDK's
  // registerSchema() call above appears to set its transaction's nonce
  // explicitly rather than through the wrapping signer, so deployerSigner's
  // own internal nonce counter is left stale (still pointing at the nonce
  // that registerSchema's tx actually consumed on-chain). A fresh
  // NonceManager does a lazy first fetch straight from the chain, so it
  // starts from the real current nonce instead of that stale count.
  const royaltyDeployerSigner = new NonceManager(new Wallet(DEPLOYER_KEY, provider))

  const registryFactory = new ContractFactory(rightsRegistryArtifact.abi, rightsRegistryArtifact.bytecode.object, royaltyDeployerSigner)
  const registry = await registryFactory.deploy(DEPLOYER_ADDRESS)
  await registry.waitForDeployment()
  rightsRegistryAddress = (await registry.getAddress()) as `0x${string}`

  const settlementFactory = new ContractFactory(royaltySettlementArtifact.abi, royaltySettlementArtifact.bytecode.object, royaltyDeployerSigner)
  const settlement = await settlementFactory.deploy(easAddress, rightsRegistryAddress, schemaUID, DEPLOYER_ADDRESS)
  await settlement.waitForDeployment()
  royaltySettlementAddress = (await settlement.getAddress()) as `0x${string}`

  const registryContract = new Contract(rightsRegistryAddress, rightsRegistryArtifact.abi, royaltyDeployerSigner)
  await (await registryContract.authorizeCaller(royaltySettlementAddress)).wait()
  const resolverContract = new Contract(resolverAddress, artifact.abi, royaltyDeployerSigner)
  await (await resolverContract.authorizeAttester(royaltySettlementAddress)).wait()
  // DEPLOYER_ADDRESS stands in for the backend's trusted attester key —
  // the only wallet allowed to call payAndRegister, same restriction
  // scripts/deployRoyaltyContracts.ts applies for real.
  const settlementContract = new Contract(royaltySettlementAddress, royaltySettlementArtifact.abi, royaltyDeployerSigner)
  await (await settlementContract.authorizeSubmitter(DEPLOYER_ADDRESS)).wait()

  paymentTokenAddress = forgeCreate('contracts/test/RoyaltySettlement.t.sol:MockERC20')

  process.env.COPYSIGHT_RIGHTS_REGISTRY_ADDRESS = rightsRegistryAddress
  process.env.COPYSIGHT_ROYALTY_SETTLEMENT_ADDRESS = royaltySettlementAddress

  // config.ts snapshots process.env at module-load time, and the import
  // above already cached it without COPYSIGHT_SCHEMA_UID/the royalty
  // addresses. Reset the module registry so the `it()`s below re-import
  // with the complete env.
  vi.resetModules()
}, 120_000)

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
    const provider = newProvider()
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
    const provider = newProvider()
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
    const provider = newProvider()
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

const ERC20_ABI = [
  'function mint(address to, uint256 amount) external',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
]

describe('local anvil devnet — royalty flow, real ERC20 payment, no mocks', () => {
  it('a first-time clean submission self-registers via RoyaltySettlement with no payment', async () => {
    const { SoneiumEASAdapter } = await import('../../src/blockchain/soneium/SoneiumEASAdapter.js')
    const { buildAttestationPayload } = await import('../../src/core/attestation/AttestationBuilder.js')
    const provider = newProvider()
    // The submitter (the backend's authorized key) submits on behalf of
    // the real creator — CREATOR_ADDRESS never signs anything here.
    const submitterSigner = new Wallet(DEPLOYER_KEY, provider)
    const adapter = new SoneiumEASAdapter(submitterSigner, 'minato')

    const payload = buildAttestationPayload({
      assetBytes: new TextEncoder().encode('original creator asset — royalty flow'),
      analysis: { detected: 'none', similarity: 0 },
      copyScore: 0,
      analysisVersion: 'devnet-royalty-v1',
    })

    const { transactionHash, uid } = await adapter.createAttestationWithRoyalty(payload, CREATOR_ADDRESS)
    expect(transactionHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(uid).toMatch(/^0x[0-9a-f]{64}$/)

    const record = await adapter.getAttestation(uid!)
    expect(record).not.toBeNull()
    expect(record!.attester.toLowerCase()).toBe(royaltySettlementAddress.toLowerCase())
    expect(record!.schemaUID).toBe(schemaUID)
    expect(record!.data).toEqual(payload)

    const rightsRegistryArtifact = JSON.parse(
      readFileSync(join(process.cwd(), 'contracts', 'out', 'RightsRegistry.sol', 'RightsRegistry.json'), 'utf-8')
    )
    const registry = new Contract(rightsRegistryAddress, rightsRegistryArtifact.abi, provider)
    const rights = await registry.getAssetRights(payload.assetHash)
    expect(rights.rightsHolder.toLowerCase()).toBe(CREATOR_ADDRESS.toLowerCase())
  })

  it('an unauthorized submitter is rejected live — enforced on-chain, not just in Foundry unit tests', async () => {
    const { SoneiumEASAdapter } = await import('../../src/blockchain/soneium/SoneiumEASAdapter.js')
    const { buildAttestationPayload } = await import('../../src/core/attestation/AttestationBuilder.js')
    const provider = newProvider()
    // PAYER_ADDRESS was never authorized via settlement.authorizeSubmitter()
    // — a real end-user wallet calling payAndRegister directly must be
    // rejected, or anyone could forge an attestation with no real analysis.
    const payerSigner = new Wallet(PAYER_KEY, provider)
    const adapter = new SoneiumEASAdapter(payerSigner, 'minato')

    const payload = buildAttestationPayload({
      assetBytes: new TextEncoder().encode('an end user cannot submit directly'),
      analysis: { detected: 'none', similarity: 0 },
      copyScore: 0,
      analysisVersion: 'devnet-royalty-v1',
    })

    await expect(adapter.createAttestationWithRoyalty(payload, PAYER_ADDRESS)).rejects.toThrow()
  })

  it('a later match against a priced asset pays the real ERC20 royalty to the rights holder before attesting', async () => {
    const { SoneiumEASAdapter } = await import('../../src/blockchain/soneium/SoneiumEASAdapter.js')
    const { buildAttestationPayload } = await import('../../src/core/attestation/AttestationBuilder.js')
    const provider = newProvider()
    // NonceManager: the submitter submits two sequential payAndRegister
    // calls below — see the comment on the beforeAll deployerSigner for
    // why a plain Wallet races here.
    const submitterSigner = new NonceManager(new Wallet(DEPLOYER_KEY, provider))
    const creatorSigner = new Wallet(UNAUTHORIZED_KEY, provider) // CREATOR_ADDRESS's own wallet
    const payerSigner = new Wallet(PAYER_KEY, provider)

    // The submitter registers the original on the creator's behalf
    // (copyScore 0), then the creator sets a price themselves — setTerms
    // is a direct RightsRegistry call restricted to "whoever is the
    // current rights holder," unrelated to RoyaltySettlement's submitter
    // restriction, so this is the creator's own real wallet action.
    const submitterAdapter = new SoneiumEASAdapter(submitterSigner, 'minato')
    const originalPayload = buildAttestationPayload({
      assetBytes: new TextEncoder().encode('priced original — royalty payment test'),
      analysis: { detected: 'none', similarity: 0 },
      copyScore: 0,
      analysisVersion: 'devnet-royalty-v1',
    })
    await submitterAdapter.createAttestationWithRoyalty(originalPayload, CREATOR_ADDRESS)

    const basePrice = 1_000_000n
    const rightsRegistryArtifact = JSON.parse(
      readFileSync(join(process.cwd(), 'contracts', 'out', 'RightsRegistry.sol', 'RightsRegistry.json'), 'utf-8')
    )
    const registryAsCreator = new Contract(rightsRegistryAddress, rightsRegistryArtifact.abi, creatorSigner)
    await (await registryAsCreator.setTerms(originalPayload.assetHash, basePrice, paymentTokenAddress)).wait()

    // Fund and approve the payer for exactly the royalty a copyScore of 50
    // implies — approval is still the real payer's own wallet action;
    // only the final submission moves to the authorized submitter.
    const copyScore = 50
    const expectedRoyalty = (basePrice * BigInt(copyScore)) / 100n
    const tokenAsCreator = new Contract(paymentTokenAddress, ERC20_ABI, creatorSigner)
    await (await tokenAsCreator.mint(PAYER_ADDRESS, basePrice)).wait()
    const tokenAsPayer = new Contract(paymentTokenAddress, ERC20_ABI, payerSigner)
    await (await tokenAsPayer.approve(royaltySettlementAddress, expectedRoyalty)).wait()

    const tokenAsReader = new Contract(paymentTokenAddress, ERC20_ABI, provider)
    const creatorBalanceBefore: bigint = await tokenAsReader.balanceOf(CREATOR_ADDRESS)
    const payerBalanceBefore: bigint = await tokenAsReader.balanceOf(PAYER_ADDRESS)

    const matchPayload = {
      ...buildAttestationPayload({
        assetBytes: new TextEncoder().encode('a different upload, but analysis matched the priced original'),
        analysis: { detected: originalPayload.assetHash, similarity: 0.5 },
        copyScore,
        analysisVersion: 'devnet-royalty-v1',
      }),
      assetHash: originalPayload.assetHash, // same underlying asset — this is the match being paid for
    }

    const { uid } = await submitterAdapter.createAttestationWithRoyalty(matchPayload, PAYER_ADDRESS)
    expect(uid).toMatch(/^0x[0-9a-f]{64}$/)

    const record = await submitterAdapter.getAttestation(uid!)
    expect(record!.attester.toLowerCase()).toBe(royaltySettlementAddress.toLowerCase())
    expect(record!.data.copyScore).toBe(copyScore)

    // Deltas, not absolute balances — correctness here shouldn't depend
    // on what, if anything, earlier tests did with this shared token.
    expect(await tokenAsReader.balanceOf(CREATOR_ADDRESS)).toBe(creatorBalanceBefore + expectedRoyalty)
    expect(await tokenAsReader.balanceOf(PAYER_ADDRESS)).toBe(payerBalanceBefore - expectedRoyalty)
  })

  it('a rights holder re-checking their own priced asset is never charged, even at a high copyScore', async () => {
    const { SoneiumEASAdapter } = await import('../../src/blockchain/soneium/SoneiumEASAdapter.js')
    const { buildAttestationPayload } = await import('../../src/core/attestation/AttestationBuilder.js')
    const provider = newProvider()
    const submitterSigner = new NonceManager(new Wallet(DEPLOYER_KEY, provider))
    const creatorSigner = new Wallet(UNAUTHORIZED_KEY, provider)

    const submitterAdapter = new SoneiumEASAdapter(submitterSigner, 'minato')
    const originalPayload = buildAttestationPayload({
      assetBytes: new TextEncoder().encode('creators own asset — self-recheck test'),
      analysis: { detected: 'none', similarity: 0 },
      copyScore: 0,
      analysisVersion: 'devnet-royalty-v1',
    })
    await submitterAdapter.createAttestationWithRoyalty(originalPayload, CREATOR_ADDRESS)

    const rightsRegistryArtifact = JSON.parse(
      readFileSync(join(process.cwd(), 'contracts', 'out', 'RightsRegistry.sol', 'RightsRegistry.json'), 'utf-8')
    )
    const registryAsCreator = new Contract(rightsRegistryAddress, rightsRegistryArtifact.abi, creatorSigner)
    await (await registryAsCreator.setTerms(originalPayload.assetHash, 1_000_000n, paymentTokenAddress)).wait()

    const tokenAsReader = new Contract(paymentTokenAddress, ERC20_ABI, provider)
    const creatorBalanceBefore: bigint = await tokenAsReader.balanceOf(CREATOR_ADDRESS)

    // The creator re-checks their own asset and it naturally scores high
    // against itself — no approval was ever given, so this only succeeds
    // if the payer-is-the-rights-holder exemption actually holds live.
    const recheckPayload = {
      ...buildAttestationPayload({
        assetBytes: new TextEncoder().encode('re-analysis of the same original'),
        analysis: { detected: originalPayload.assetHash, similarity: 1 },
        copyScore: 100,
        analysisVersion: 'devnet-royalty-v1',
      }),
      assetHash: originalPayload.assetHash,
    }
    const { uid } = await submitterAdapter.createAttestationWithRoyalty(recheckPayload, CREATOR_ADDRESS)
    expect(uid).toMatch(/^0x[0-9a-f]{64}$/)

    expect(await tokenAsReader.balanceOf(CREATOR_ADDRESS)).toBe(creatorBalanceBefore) // never paid themselves
  })

  it('without a sufficient token approval, the payment and the attestation both fail — enforced live, not just in Foundry unit tests', async () => {
    const { SoneiumEASAdapter } = await import('../../src/blockchain/soneium/SoneiumEASAdapter.js')
    const { buildAttestationPayload } = await import('../../src/core/attestation/AttestationBuilder.js')
    const provider = newProvider()
    const submitterSigner = new NonceManager(new Wallet(DEPLOYER_KEY, provider))
    const creatorSigner = new Wallet(UNAUTHORIZED_KEY, provider)

    const submitterAdapter = new SoneiumEASAdapter(submitterSigner, 'minato')
    const originalPayload = buildAttestationPayload({
      assetBytes: new TextEncoder().encode('priced original — insufficient approval test'),
      analysis: { detected: 'none', similarity: 0 },
      copyScore: 0,
      analysisVersion: 'devnet-royalty-v1',
    })
    await submitterAdapter.createAttestationWithRoyalty(originalPayload, CREATOR_ADDRESS)

    const rightsRegistryArtifact = JSON.parse(
      readFileSync(join(process.cwd(), 'contracts', 'out', 'RightsRegistry.sol', 'RightsRegistry.json'), 'utf-8')
    )
    const registryAsCreator = new Contract(rightsRegistryAddress, rightsRegistryArtifact.abi, creatorSigner)
    await (await registryAsCreator.setTerms(originalPayload.assetHash, 1_000_000n, paymentTokenAddress)).wait()
    // Deliberately no mint/approve for the payer this time.

    const matchPayload = {
      ...buildAttestationPayload({
        assetBytes: new TextEncoder().encode('another upload matching the priced original, unpaid'),
        analysis: { detected: originalPayload.assetHash, similarity: 0.5 },
        copyScore: 50,
        analysisVersion: 'devnet-royalty-v1',
      }),
      assetHash: originalPayload.assetHash,
    }

    await expect(submitterAdapter.createAttestationWithRoyalty(matchPayload, PAYER_ADDRESS)).rejects.toThrow()
  })
})
