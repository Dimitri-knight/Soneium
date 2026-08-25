export interface AttestationInput {
  assetHash: `0x${string}`
  analysisHash: `0x${string}`
  copyScore: number
  analysisVersionHash: `0x${string}`
  recipient?: `0x${string}`
}

export interface AttestationRecord {
  uid: `0x${string}`
  attester: `0x${string}`
  recipient: `0x${string}`
  schemaUID: `0x${string}`
  timestamp: bigint
  revoked: boolean
  data: AttestationInput
}

export type TransactionStatus = 'PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED'

/**
 * Chain-agnostic interface. CopySight's core logic (hashing,
 * canonicalization, orchestration) depends only on this — never on
 * Soneium/EAS specifics directly. Adding a second chain later means a
 * new adapter implementing this interface; nothing else changes. This is
 * the concrete piece satisfying the client's portability requirement.
 */
export interface BlockchainAdapter {
  createAttestation(
    input: AttestationInput
  ): Promise<{ transactionHash: `0x${string}`; uid?: `0x${string}` }>
  getAttestation(uid: `0x${string}`): Promise<AttestationRecord | null>
  verifyAttestation(uid: `0x${string}`): Promise<boolean>
  waitForConfirmation(transactionHash: `0x${string}`): Promise<TransactionStatus>
}
