import { sha256 } from 'viem'

/**
 * Deterministic hash of the original asset bytes — SHA-256, per the
 * architect's spec (chosen over keccak256 for asset/document hard
 * bindings, consistent with C2PA convention). The actual file is never
 * stored on-chain, only this fingerprint.
 */
export function hashAsset(fileBytes: Uint8Array): `0x${string}` {
  return sha256(fileBytes)
}
