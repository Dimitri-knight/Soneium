import type { TransactionStatus } from '../blockchain/BlockchainAdapter.js'

/**
 * Persistence record linking an asset to its on-chain attestation. Plain
 * data shape only — no DB client wired in yet (deferred, see SETUP.md).
 * BlockchainProofService depends on the BlockchainProofStore interface,
 * not on this being backed by any particular database.
 */
export interface BlockchainProof {
  assetId: string
  assetHash: `0x${string}`
  analysisHash: `0x${string}`
  copyScore: number
  analysisVersion: string
  analysisVersionHash: `0x${string}`
  chainId: number
  schemaUID: `0x${string}`
  attestationUID: `0x${string}` | null
  transactionHash: `0x${string}` | null
  attester: `0x${string}` | null
  status: TransactionStatus
  timestamp: number | null
}
