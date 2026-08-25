import { sha256, stringToBytes } from 'viem'

/**
 * Idempotency-key computation and retry-with-backoff, usable by any
 * adapter or service that submits blockchain transactions.
 *
 * OPEN QUESTION FOR ARCHITECT: the spec names TransactionManager with
 * status-tracking responsibilities (transactionHash, attestationUID,
 * status, PENDING/SUBMITTED/CONFIRMED/FAILED) that overlap with what
 * BlockchainProofService already owns per-asset. Built the narrower
 * interpretation here — idempotency + retry only — to avoid two modules
 * independently tracking the same state. Confirm this is the intended
 * split before assuming it's final.
 */

export interface IdempotencyKeyInput {
  tenant: string
  assetHash: `0x${string}`
  analysisVersionHash: `0x${string}`
  schemaUID: `0x${string}`
}

/** Deterministic key so the same (tenant, asset, analysis version, schema) never gets attested twice by accident. */
export function computeIdempotencyKey(input: IdempotencyKeyInput): `0x${string}` {
  const material = `${input.tenant}:${input.assetHash}:${input.analysisVersionHash}:${input.schemaUID}`
  return sha256(stringToBytes(material))
}

export interface RetryOptions {
  maxAttempts?: number
  baseDelayMs?: number
}

/** Retries a transient failure with exponential backoff. Rethrows the last error once maxAttempts is exhausted. */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 500 } = options
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt === maxAttempts) break
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)))
    }
  }

  throw lastError
}
