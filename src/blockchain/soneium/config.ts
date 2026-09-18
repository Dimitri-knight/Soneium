import 'dotenv/config'
import { defineChain } from 'viem'

const MINATO_PUBLIC_RPC = 'https://rpc.minato.soneium.org/'

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/
const SCHEMA_UID_PATTERN = /^0x[0-9a-fA-F]{64}$/

/**
 * Validates address/UID-shaped env vars at config-load time instead of
 * letting a malformed value (missing 0x prefix, wrong length, stray
 * whitespace) fail later with an opaque error deep inside ethers/EAS-SDK.
 */
function validateHexShape(
  envVarName: string,
  rawValue: string,
  pattern: RegExp,
  shapeDescription: string
): `0x${string}` | '' {
  if (!rawValue) return ''
  if (!pattern.test(rawValue)) {
    throw new Error(
      `${envVarName} is set to "${rawValue}", which is not a valid ${shapeDescription}. ` +
        'Check for a missing 0x prefix, wrong length, or stray whitespace.'
    )
  }
  return rawValue as `0x${string}`
}

function validateAddress(envVarName: string, rawValue: string): `0x${string}` | '' {
  return validateHexShape(envVarName, rawValue, ADDRESS_PATTERN, '40-hex-character address')
}

function validateSchemaUID(envVarName: string, rawValue: string): `0x${string}` | '' {
  return validateHexShape(envVarName, rawValue, SCHEMA_UID_PATTERN, '64-hex-character schema UID')
}

/**
 * Soneium Minato (testnet), chain ID 1946. Default RPC is Soneium's
 * public endpoint — fine for dev/demo, but rate-limited; use a
 * dedicated provider before real traffic.
 */
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

/**
 * Soneium Mainnet, chain ID 1868. Exists for environment separation —
 * nothing here deploys or attests to Mainnet automatically.
 */
export const soneiumMainnet = defineChain({
  id: 1868,
  name: 'Soneium',
  network: 'soneium-mainnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.SONEIUM_MAINNET_RPC_URL || ''] },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://soneium.blockscout.com/' },
  },
  testnet: false,
})

/** Standard OP Stack predeploys — same addresses on Mainnet and Minato. */
export const CONTRACTS = {
  schemaRegistry: (validateAddress(
    'SONEIUM_SCHEMA_REGISTRY_ADDRESS',
    process.env.SONEIUM_SCHEMA_REGISTRY_ADDRESS || ''
  ) || '0x4200000000000000000000000000000000000020') as `0x${string}`,
  eas: (validateAddress('SONEIUM_EAS_ADDRESS', process.env.SONEIUM_EAS_ADDRESS || '') ||
    '0x4200000000000000000000000000000000000021') as `0x${string}`,
} as const

export type NetworkEnvironment = 'minato' | 'mainnet'

export interface EnvironmentConfig {
  chain: typeof soneiumMinato | typeof soneiumMainnet
  rpcUrl: string
  chainId: number
  schemaUID: `0x${string}` | ''
  attesterAddress: `0x${string}` | ''
  attesterPrivateKey: string
  resolverAddress: `0x${string}` | ''
}

const environments: Record<NetworkEnvironment, EnvironmentConfig> = {
  minato: {
    chain: soneiumMinato,
    rpcUrl: process.env.SONEIUM_RPC_URL || MINATO_PUBLIC_RPC,
    chainId: Number(process.env.SONEIUM_CHAIN_ID || 1946),
    schemaUID: validateSchemaUID('COPYSIGHT_SCHEMA_UID', process.env.COPYSIGHT_SCHEMA_UID || ''),
    attesterAddress: validateAddress(
      'COPYSIGHT_ATTESTER_ADDRESS',
      process.env.COPYSIGHT_ATTESTER_ADDRESS || ''
    ),
    attesterPrivateKey: process.env.COPYSIGHT_ATTESTER_PRIVATE_KEY || '',
    resolverAddress: validateAddress(
      'COPYSIGHT_RESOLVER_ADDRESS',
      process.env.COPYSIGHT_RESOLVER_ADDRESS || ''
    ),
  },
  mainnet: {
    chain: soneiumMainnet,
    rpcUrl: process.env.SONEIUM_MAINNET_RPC_URL || '',
    chainId: Number(process.env.SONEIUM_MAINNET_CHAIN_ID || 1868),
    schemaUID: validateSchemaUID(
      'COPYSIGHT_MAINNET_SCHEMA_UID',
      process.env.COPYSIGHT_MAINNET_SCHEMA_UID || ''
    ),
    attesterAddress: validateAddress(
      'COPYSIGHT_MAINNET_ATTESTER_ADDRESS',
      process.env.COPYSIGHT_MAINNET_ATTESTER_ADDRESS || ''
    ),
    attesterPrivateKey: process.env.COPYSIGHT_MAINNET_ATTESTER_PRIVATE_KEY || '',
    resolverAddress: validateAddress(
      'COPYSIGHT_MAINNET_RESOLVER_ADDRESS',
      process.env.COPYSIGHT_MAINNET_RESOLVER_ADDRESS || ''
    ),
  },
}

export function getEnvironmentConfig(environment: NetworkEnvironment): EnvironmentConfig {
  return environments[environment]
}

/** Back-compat default: existing code importing `config` unchanged gets Minato. */
export const config = environments.minato
