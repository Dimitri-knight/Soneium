export interface AttestationInput {
  assetHash: `0x${string}`
  analysisHash: `0x${string}`
  copyScore: number
  analysisVersionHash: `0x${string}`
  recipient?: `0x${string}`
  /**
   * UID of a prior attestation this one supersedes (e.g. a re-analysis
   * of the same asset). Uses EAS's native refUID field rather than our
   * schema data — the old attestation is never edited, a new one just
   * points back at it. Omit for a first-time attestation.
   */
  refUID?: `0x${string}`
}

export interface AttestationRecord {
  uid: `0x${string}`
  attester: `0x${string}`
  recipient: `0x${string}`
  schemaUID: `0x${string}`
  timestamp: bigint
  revoked: boolean
  /** EAS's native refUID — zero-bytes32 if this attestation doesn't supersede anything. */
  refUID: `0x${string}`
  data: AttestationInput
}

/**
 * REVOKED differs from the others: PENDING/SUBMITTED/CONFIRMED/FAILED
 * track a single transaction's lifecycle, while REVOKED reflects a
 * previously CONFIRMED attestation being revoked later on-chain. Only
 * reachable if the schema is revocable, which this one isn't — kept
 * for type completeness.
 */
export type TransactionStatus = 'PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED' | 'REVOKED'

/**
 * Chain-agnostic interface. CopySight's core logic (hashing,
 * canonicalization, orchestration) depends only on this, never on
 * Soneium/EAS specifics directly — a second chain just means a new
 * adapter implementing this interface.
 */
export interface BlockchainAdapter {
  createAttestation(
    input: AttestationInput
  ): Promise<{ transactionHash: `0x${string}`; uid?: `0x${string}` }>
  getAttestation(uid: `0x${string}`): Promise<AttestationRecord | null>
  verifyAttestation(uid: `0x${string}`): Promise<boolean>
  waitForConfirmation(transactionHash: `0x${string}`): Promise<TransactionStatus>
}
