import 'dotenv/config'
import { defineChain } from 'viem'

/**
 * Soneium Minato (testnet). Chain ID confirmed via Soneium docs: 1946.
 * Soneium Mainnet (chain ID 1868) is intentionally NOT configured here —
 * mainnet is out of scope until this sandbox milestone is accepted.
 *
 * Default RPC is Soneium's public Minato endpoint, verified live against
 * https://docs.soneium.org/docs/builders/overview. Fine for this dev/demo
 * phase; Soneium's own docs say it's rate-limited and not for production —
 * get a dedicated provider before mainnet. SONEIUM_RPC_URL in .env
 * overrides this default if set.
 */
const MINATO_PUBLIC_RPC = 'https://rpc.minato.soneium.org/'

export const soneiumMinato = defineChain({
  id: 1946,
  name: 'Soneium Minato',
  network: 'soneium-minato',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.SONEIUM_RPC_URL || MINATO_PUBLIC_RPC] },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://soneium-minato.blockscout.com/' },
  },
  testnet: true,
})

/** Standard OP Stack predeploys — identical on Soneium Mainnet and Minato. */
export const CONTRACTS = {
  schemaRegistry: (process.env.SONEIUM_SCHEMA_REGISTRY_ADDRESS ||
    '0x4200000000000000000000000000000000000020') as `0x${string}`,
  eas: (process.env.SONEIUM_EAS_ADDRESS ||
    '0x4200000000000000000000000000000000000021') as `0x${string}`,
} as const

export const config = {
  rpcUrl: process.env.SONEIUM_RPC_URL || MINATO_PUBLIC_RPC,
  chainId: Number(process.env.SONEIUM_CHAIN_ID || 1946),
  schemaUID: (process.env.COPYSIGHT_SCHEMA_UID || '') as `0x${string}` | '',
  attesterAddress: (process.env.COPYSIGHT_ATTESTER_ADDRESS || '') as `0x${string}` | '',
  attesterPrivateKey: process.env.COPYSIGHT_ATTESTER_PRIVATE_KEY || '',
}
