import { sha256, stringToBytes } from 'viem'
import type { BlockchainAdapter } from '../BlockchainAdapter.js'
import { classifyError } from '../../core/logging/errorClassification.js'
import { logger } from '../../core/logging/logger.js'

/**
 * Idempotency-key computation, retry-with-backoff, and stuck-transaction
 * recovery, usable by any adapter or service that submits blockchain
 * transactions.
 *
 * Nonce management deliberately isn't handled here — it's the Signer's
 * job, via ethers' NonceManager in SignerService, since nonce sequencing
 * is a property of the account rather than of an individual transaction
 * attempt.
 *
 * Scoped narrower than a full status-tracking manager to avoid
 * duplicating state that BlockchainProofService already owns per-asset.
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

/**
 * Transient RPC/network error kinds worth retrying, plus 'UNKNOWN' as a
 * conservative default. Excludes CALL_EXCEPTION (an on-chain revert,
 * e.g. CopySightResolver rejecting an unauthorized attester or an
 * out-of-range copyScore), INSUFFICIENT_FUNDS, and other permanent
 * kinds — retrying the same call would just fail identically again.
 */
const TRANSIENT_ERROR_KINDS = new Set(['NETWORK_ERROR', 'SERVER_ERROR', 'TIMEOUT', 'UNKNOWN'])

/** Retries a transient failure with exponential backoff. Rethrows immediately on a permanent (non-transient) error, or once maxAttempts is exhausted. */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 500 } = options
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      const classified = classifyError(err)
      if (!TRANSIENT_ERROR_KINDS.has(classified.kind)) {
        logger.warn('transaction_manager.retry_skipped_permanent_error', { attempt, ...classified })
        throw err
      }
      if (attempt === maxAttempts) break
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)))
    }
  }

  throw lastError
}

export type RecoveryOutcome = 'ALREADY_CONFIRMED' | 'NEEDS_RESUBMIT'

/**
 * Called when waitForConfirmation times out (returns PENDING instead of
 * a definitive CONFIRMED/FAILED). Reconciles by checking whether the
 * attestation actually landed on-chain before deciding to resubmit,
 * rather than attempting a same-nonce, bumped-gas replacement — this
 * avoids double-attesting the same asset with much lower risk.
 */
export async function recoverStuckAttestation(
  adapter: BlockchainAdapter,
  uid: `0x${string}` | undefined
): Promise<RecoveryOutcome> {
  if (!uid) {
    // Never got a UID back from the original submission at all — nothing to reconcile against.
    return 'NEEDS_RESUBMIT'
  }
  const record = await adapter.getAttestation(uid)
  return record ? 'ALREADY_CONFIRMED' : 'NEEDS_RESUBMIT'
}
