import { createPublicClient, http } from 'viem'
import { CONTRACTS, config, soneiumMinato } from '../src/blockchain/soneium/config.js'

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

  console.log(`chainId=${chainId} (expected 1946)`)
  console.log(`latestBlock=${blockNumber}`)
  console.log(`SchemaRegistry has code: ${Boolean(schemaRegistryCode)}`)
  console.log(`EAS has code: ${Boolean(easCode)}`)
  console.log(
    config.schemaUID
      ? `COPYSIGHT_SCHEMA_UID is set: ${config.schemaUID}`
      : 'COPYSIGHT_SCHEMA_UID not set yet — schema not registered.'
  )
  console.log(
    config.attesterPrivateKey
      ? 'COPYSIGHT_ATTESTER_PRIVATE_KEY is set.'
      : 'COPYSIGHT_ATTESTER_PRIVATE_KEY not set — wallet not configured yet.'
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
