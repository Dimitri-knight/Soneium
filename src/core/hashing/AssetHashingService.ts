import { sha256 } from 'viem'

/**
 * Deterministic hash of the original asset bytes. SHA-256 rather than
 * keccak256, for consistency with the C2PA convention for asset/document
 * bindings. Only this fingerprint is stored on-chain, never the file itself.
 */
export function hashAsset(fileBytes: Uint8Array): `0x${string}` {
  return sha256(fileBytes)
}
