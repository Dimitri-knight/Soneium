import { EAS, SchemaRegistry, ZERO_BYTES32 } from '@ethereum-attestation-service/eas-sdk'
import { JsonRpcProvider, Wallet } from 'ethers'
import type {
  AttestationInput,
  AttestationRecord,
  BlockchainAdapter,
  TransactionStatus,
} from '../BlockchainAdapter.js'
import { COPYSIGHT_ANALYSIS_SCHEMA } from '../../schemas/CopySightAnalysisSchema.js'
import { decodeAttestationData, encodeAttestationData } from './attestationCodec.js'
import { CONTRACTS, config } from './config.js'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/**
 * All Soneium/EAS-specific logic lives here. Everything outside this file
 * talks to BlockchainAdapter's interface only.
 *
 * DEPENDENCY NOTE: the EAS SDK's documented, tested API (verified against
 * the installed v2.9.1's own README, not assumed) expects an ethers.js
 * Signer/Provider for `.connect()` — not a viem client, even though viem
 * is one of the SDK's own dependencies internally. Rather than hand-roll
 * raw contract calls against the SchemaRegistry/EAS ABIs from memory,
 * this adapter uses the SDK's official path via ethers. viem stays the
 * general-purpose client everywhere else (config, RPC checks).
 *
 * STATUS: written against the documented API, not yet run against a live
 * network — needs a funded attester wallet (blocked on the Minato
 * faucet) before this can actually be exercised end to end.
 */
export class SoneiumEASAdapter implements BlockchainAdapter {
  private readonly provider: JsonRpcProvider
  private readonly signer: Wallet
  private readonly eas: EAS
  private readonly schemaRegistry: SchemaRegistry

  constructor() {
    if (!config.attesterPrivateKey) {
      throw new Error(
        'COPYSIGHT_ATTESTER_PRIVATE_KEY is not set — cannot construct a signer. ' +
          'Copy .env.example to .env and fill it in.'
      )
    }

    this.provider = new JsonRpcProvider(config.rpcUrl, config.chainId)
    this.signer = new Wallet(config.attesterPrivateKey, this.provider)

    this.eas = new EAS(CONTRACTS.eas)
    this.eas.connect(this.signer)

    this.schemaRegistry = new SchemaRegistry(CONTRACTS.schemaRegistry)
    this.schemaRegistry.connect(this.signer)
  }

  /**
   * One-time: registers the CopySight schema on Soneium and returns the
   * resulting schemaUID. Called by scripts/registerSoneiumSchema.ts, not
   * part of the per-asset flow. Do not call until the schema-content
   * question (see CopySightAnalysisSchema.ts) is confirmed — this is
   * effectively irreversible.
   */
  async registerSchema(): Promise<`0x${string}`> {
    const tx = await this.schemaRegistry.register({
      schema: COPYSIGHT_ANALYSIS_SCHEMA,
      resolverAddress: ZERO_ADDRESS,
      revocable: false, // must match src/schemas/CopySightAnalysisSchema.ts
    })
    const schemaUID = await tx.wait()
    return schemaUID as `0x${string}`
  }

  async createAttestation(
    input: AttestationInput
  ): Promise<{ transactionHash: `0x${string}`; uid?: `0x${string}` }> {
    if (!config.schemaUID) {
      throw new Error('COPYSIGHT_SCHEMA_UID is not set — register the schema first.')
    }

    const encodedData = encodeAttestationData(input)

    const tx = await this.eas.attest({
      schema: config.schemaUID,
      data: {
        recipient: input.recipient ?? ZERO_ADDRESS,
        expirationTime: 0n,
        revocable: false, // must match the registered schema's own flag
        refUID: input.refUID ?? ZERO_BYTES32,
        data: encodedData,
      },
    })

    const uid = await tx.wait()

    return {
      transactionHash: tx.receipt?.hash as `0x${string}`,
      uid: uid as `0x${string}`,
    }
  }

  async getAttestation(uid: `0x${string}`): Promise<AttestationRecord | null> {
    const attestation = await this.eas.getAttestation(uid)

    if (!attestation || attestation.attester === ZERO_ADDRESS) {
      return null
    }

    return {
      uid: attestation.uid as `0x${string}`,
      attester: attestation.attester as `0x${string}`,
      recipient: attestation.recipient as `0x${string}`,
      schemaUID: attestation.schema as `0x${string}`,
      timestamp: BigInt(attestation.time),
      revoked: BigInt(attestation.revocationTime) > 0n,
      refUID: attestation.refUID as `0x${string}`,
      data: decodeAttestationData(attestation.data),
    }
  }

  /**
   * Checks the attestation exists, belongs to the CopySight schema, and
   * was signed by the configured attester address. This off-chain check
   * is what replaces a custom resolver contract for MVP — see
   * src/core/verification/AttestationVerifier.ts for the module that
   * calls this at the application level.
   */
  async verifyAttestation(uid: `0x${string}`): Promise<boolean> {
    const attestation = await this.getAttestation(uid)
    if (!attestation) return false
    if (attestation.schemaUID !== config.schemaUID) return false
    if (
      config.attesterAddress &&
      attestation.attester.toLowerCase() !== config.attesterAddress.toLowerCase()
    ) {
      return false
    }
    return !attestation.revoked
  }

  async waitForConfirmation(transactionHash: `0x${string}`): Promise<TransactionStatus> {
    // Explicit timeout (verified against ethers' actual Provider type,
    // not assumed) — without one, a slow/stuck RPC could hang this call
    // indefinitely. 60s is generous for Minato block times; returning
    // PENDING on timeout rather than throwing keeps the caller's status
    // model consistent instead of surfacing a raw ethers error.
    const receipt = await this.provider.waitForTransaction(transactionHash, 1, 60_000)
    if (!receipt) return 'PENDING'
    return receipt.status === 1 ? 'CONFIRMED' : 'FAILED'
  }
}
