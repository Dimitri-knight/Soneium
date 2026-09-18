import { createPublicClient, http } from 'viem'
import { pathToFileURL } from 'node:url'
import { CONTRACTS, config, soneiumMinato } from '../src/blockchain/soneium/config.js'

const EXPECTED_CHAIN_ID = soneiumMinato.id

export interface MinatoSetupInputs {
  chainId: number
  blockNumber: bigint
  schemaRegistryCode: string | undefined
  easCode: string | undefined
  schemaUID: string
  attesterPrivateKey: string
}

export interface MinatoSetupResult {
  ok: boolean
  lines: string[]
}

/**
 * Pure evaluation of the gathered setup facts into report lines and a
 * pass/fail verdict, extracted so it's unit-testable without a live RPC
 * connection.
 *
 * chainId mismatch and missing SchemaRegistry/EAS bytecode are hard
 * failures. Missing COPYSIGHT_SCHEMA_UID / COPYSIGHT_ATTESTER_PRIVATE_KEY
 * are only reported, not failed — both are legitimately unset at this
 * stage (schema not registered yet / wallet not funded yet).
 */
export function evaluateMinatoSetup(inputs: MinatoSetupInputs): MinatoSetupResult {
  const lines: string[] = []
  let ok = true

  const chainIdMatches = inputs.chainId === EXPECTED_CHAIN_ID
  lines.push(`chainId=${inputs.chainId} (expected ${EXPECTED_CHAIN_ID})`)
  if (!chainIdMatches) {
    lines.push(`[FAIL] chainId ${inputs.chainId} does not match expected ${EXPECTED_CHAIN_ID}.`)
    ok = false
  }

  lines.push(`latestBlock=${inputs.blockNumber}`)

  const hasSchemaRegistryCode = Boolean(inputs.schemaRegistryCode)
  lines.push(`SchemaRegistry has code: ${hasSchemaRegistryCode}`)
  if (!hasSchemaRegistryCode) {
    lines.push(`[FAIL] SchemaRegistry has no code at ${CONTRACTS.schemaRegistry}.`)
    ok = false
  }

  const hasEasCode = Boolean(inputs.easCode)
  lines.push(`EAS has code: ${hasEasCode}`)
  if (!hasEasCode) {
    lines.push(`[FAIL] EAS has no code at ${CONTRACTS.eas}.`)
    ok = false
  }

  lines.push(
    inputs.schemaUID
      ? `COPYSIGHT_SCHEMA_UID is set: ${inputs.schemaUID}`
      : 'COPYSIGHT_SCHEMA_UID not set yet — schema not registered.'
  )
  lines.push(
    inputs.attesterPrivateKey
      ? 'COPYSIGHT_ATTESTER_PRIVATE_KEY is set.'
      : 'COPYSIGHT_ATTESTER_PRIVATE_KEY not set — wallet not configured yet.'
  )

  return { ok, lines }
}

/**
 * Sanity check for the whole Minato setup: RPC reachability, expected
 * chain ID, whether the EAS/SchemaRegistry contracts actually have code
 * at the expected addresses, and whether env config is complete.
 */
async function main() {
  const client = createPublicClient({ chain: soneiumMinato, transport: http() })

  const [chainId, blockNumber, schemaRegistryCode, easCode] = await Promise.all([
    client.getChainId(),
    client.getBlockNumber(),
    client.getCode({ address: CONTRACTS.schemaRegistry }),
    client.getCode({ address: CONTRACTS.eas }),
  ])

  const { ok, lines } = evaluateMinatoSetup({
    chainId,
    blockNumber,
    schemaRegistryCode,
    easCode,
    schemaUID: config.schemaUID,
    attesterPrivateKey: config.attesterPrivateKey,
  })

  for (const line of lines) console.log(line)

  if (!ok) {
    process.exit(1)
  }
}

// Guarded so this module can be imported (e.g. by tests, for
// evaluateMinatoSetup) without triggering a live RPC connection attempt.
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
