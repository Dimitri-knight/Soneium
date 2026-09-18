import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Contract } from 'ethers'
import { EnvSignerService } from '../src/blockchain/signing/SignerService.js'
import { config } from '../src/blockchain/soneium/config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export type ManageAttesterAction = 'authorize' | 'deauthorize'

export interface ManageAttesterArgs {
  action: ManageAttesterAction
  attesterAddress: string
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/

/**
 * Pure CLI argument validation, extracted from main() so it's
 * unit-testable without a signer, RPC, or contract. Throws a descriptive
 * Error on the first invalid input (missing/invalid action, malformed
 * address, resolver not configured); returns the parsed args on success.
 */
export function parseManageAttesterArgs(argv: string[], resolverAddress: string): ManageAttesterArgs {
  const [action, attesterAddress] = argv

  if (action !== 'authorize' && action !== 'deauthorize') {
    throw new Error('Usage: tsx scripts/manageAttester.ts <authorize|deauthorize> <address>')
  }
  if (!attesterAddress || !ADDRESS_PATTERN.test(attesterAddress)) {
    throw new Error('Second argument must be a valid 0x-prefixed address.')
  }
  if (!resolverAddress) {
    throw new Error('COPYSIGHT_RESOLVER_ADDRESS is not set — deploy the resolver first (deploy:resolver).')
  }

  return { action, attesterAddress }
}

/**
 * Admin utility to authorize or deauthorize an attester address on the
 * deployed CopySightResolver — the signer-rotation mechanism. Must be
 * called with the resolver owner's key (COPYSIGHT_ATTESTER_PRIVATE_KEY,
 * assuming deployer and attester share a key).
 *
 * Usage:
 *   npx tsx scripts/manageAttester.ts authorize 0xNewAttesterAddress
 *   npx tsx scripts/manageAttester.ts deauthorize 0xOldAttesterAddress
 */
async function main() {
  const { action, attesterAddress } = parseManageAttesterArgs(process.argv.slice(2), config.resolverAddress)

  const artifactPath = join(
    __dirname,
    '..',
    'contracts',
    'out',
    'CopySightResolver.sol',
    'CopySightResolver.json'
  )
  if (!existsSync(artifactPath)) {
    throw new Error(`Compiled artifact not found at ${artifactPath}. Run "forge build" first.`)
  }
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'))

  const signerService = new EnvSignerService()
  const signer = await signerService.getSigner('minato')

  const resolver = new Contract(config.resolverAddress, artifact.abi, signer)

  const fn = action === 'authorize' ? 'authorizeAttester' : 'deauthorizeAttester'
  console.log(`Calling ${fn}(${attesterAddress}) on resolver ${config.resolverAddress}...`)

  const tx = await resolver[fn](attesterAddress)
  const receipt = await tx.wait()

  // ethers v6's tx.wait() throws before returning if the receipt status
  // isn't 1 (caught by main().catch below), so status is always 1 here.
  console.log(`Done. tx=${receipt?.hash}`)
}

// Guarded so this module can be imported (e.g. by tests, for
// parseManageAttesterArgs) without attempting a live contract call.
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
