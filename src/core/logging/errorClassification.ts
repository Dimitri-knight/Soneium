import { isError } from 'ethers'

export interface ClassifiedError {
  /** Ethers' machine-readable error code, or 'UNKNOWN' for anything else. */
  kind: string
  message: string
  /** CALL_EXCEPTION only: human-readable revert reason, if the chain provided one (often null for a custom Solidity error — see `data` instead). */
  reason?: string | null
  /** CALL_EXCEPTION only: raw revert data (e.g. a custom error selector such as CopySightResolver's UnauthorizedAttester/InvalidCopyScore). */
  data?: string | null
}

/**
 * Normalizes an unknown thrown value into a structured, loggable shape.
 *
 * Ethers errors carry a machine-readable `.code` (NETWORK_ERROR, TIMEOUT,
 * CALL_EXCEPTION, INSUFFICIENT_FUNDS, etc.) plus a `.shortMessage`, which is
 * more useful for triage than a raw `.message`. CALL_EXCEPTION also carries
 * `.reason`/`.data`, which surfaces a CopySightResolver-level rejection
 * instead of a generic "execution reverted".
 *
 * Anything without a real ethers `.code` (e.g. a plain Error from our own
 * code) falls back to 'UNKNOWN' rather than being misreported as a
 * network/chain issue.
 */
export function classifyError(err: unknown): ClassifiedError {
  if (isError(err, 'CALL_EXCEPTION')) {
    return { kind: 'CALL_EXCEPTION', message: err.shortMessage, reason: err.reason, data: err.data }
  }
  if (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string') {
    const { code } = err as { code: string }
    const shortMessage = 'shortMessage' in err ? (err as { shortMessage?: unknown }).shortMessage : undefined
    return {
      kind: code,
      message: typeof shortMessage === 'string' ? shortMessage : err instanceof Error ? err.message : String(err),
    }
  }
  return { kind: 'UNKNOWN', message: err instanceof Error ? err.message : String(err) }
}
