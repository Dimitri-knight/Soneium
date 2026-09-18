import type { TransactionStatus } from '../blockchain/BlockchainAdapter.js'

/**
 * Persistence record linking an asset to its on-chain attestation.
 * BlockchainProofService depends on the BlockchainProofStore interface,
 * not on any particular database backing it.
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
  /** Backfilled by BlockchainProofService once status reaches CONFIRMED (via adapter.getAttestation); stays null if that backfill read fails even though the attestation itself confirmed. */
  attester: `0x${string}` | null
  status: TransactionStatus
  timestamp: number | null
  /** UID of the attestation this one supersedes (re-analysis case), or null for a first-time proof. */
  refUID: `0x${string}` | null
  /** From TransactionManager.computeIdempotencyKey — lets BlockchainProofService detect and dedupe a repeated request for the same underlying content. */
  idempotencyKey: `0x${string}`
}
