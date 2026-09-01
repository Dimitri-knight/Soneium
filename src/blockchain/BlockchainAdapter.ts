export interface AttestationInput {
  assetHash: `0x${string}`
  analysisHash: `0x${string}`
  copyScore: number
  analysisVersionHash: `0x${string}`
  recipient?: `0x${string}`
  /**
   * UID of a prior attestation this one supersedes — e.g. a re-analysis
   * of the same asset. Uses EAS's own native refUID field (not part of
   * our custom schema data), matching the append-only correction
   * pattern: the old attestation is never edited, a new one just points
   * back at it. Omit for a first-time attestation.
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
 * REVOKED is distinct from the others: PENDING/SUBMITTED/CONFIRMED/FAILED
 * describe a single transaction's lifecycle right after submission.
 * REVOKED describes a *later* discovery — a previously CONFIRMED
 * attestation was subsequently revoked on-chain. Only reachable at all
 * if the schema's `revocable` flag is true (see the note in
 * CopySightAnalysisSchema.ts and CopySightResolver.sol) — still an open
 * question with Architect.
 */
export type TransactionStatus = 'PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED' | 'REVOKED'

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
