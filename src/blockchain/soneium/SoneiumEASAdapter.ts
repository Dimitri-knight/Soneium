// Namespace import + resolveEasSdkModule — see easSdkInterop.ts for why.
// Types are imported separately since type-only imports are erased at
// compile time and don't go through runtime module resolution. `EAS`/
// `SchemaRegistry` are used below both as values (the destructured
// constructors) and as instance types (field annotations).
import * as EasSdkNs from '@ethereum-attestation-service/eas-sdk'
import type { EAS as EASInstance, SchemaRegistry as SchemaRegistryInstance } from '@ethereum-attestation-service/eas-sdk'
import { resolveEasSdkModule } from './easSdkInterop.js'
import { Contract, Interface, isError, type Signer } from 'ethers'
import type {
  AttestationInput,
  AttestationRecord,
  BlockchainAdapter,
  TransactionStatus,
} from '../BlockchainAdapter.js'
import { COPYSIGHT_ANALYSIS_SCHEMA } from '../../schemas/CopySightAnalysisSchema.js'
import { decodeAttestationData, encodeAttestationData } from './attestationCodec.js'
import { CONTRACTS, getEnvironmentConfig, type EnvironmentConfig, type NetworkEnvironment } from './config.js'
import { withRetry } from '../transactions/TransactionManager.js'

const { EAS, SchemaRegistry, ZERO_BYTES32 } = resolveEasSdkModule(EasSdkNs)
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// Hand-written, not read from contracts/out/ — application source code
// depending on a Foundry build artifact at runtime would be fragile
// (breaks if contracts/out/ is missing or stale). Scripts already read
// the real artifact for deployment, which is the right place for that.
const ROYALTY_SETTLEMENT_ABI = [
  'function payAndRegister(address payer, bytes32 assetHash, bytes32 analysisHash, uint8 copyScore, bytes32 analysisVersionHash, bytes32 knownIPId) returns (bytes32)',
]

// payAndRegister's own return value (the attestation UID) isn't
// retrievable from a real mined transaction the normal way — only logs
// are available after the fact, not decoded return values. EAS's own
// Attested event always carries it, emitted with RoyaltySettlement's
// address as `attester` regardless of which of its three registry-lookup
// branches ran, so parsing it from the receipt works for every case.
const EAS_ATTESTED_EVENT_ABI = [
  'event Attested(address indexed recipient, address indexed attester, bytes32 uid, bytes32 indexed schemaUID)',
]

/** Only what Interface.parseLog itself actually needs — a real ContractTransactionReceipt satisfies this structurally, and so does a plain fake in a test. */
export interface LogsWithTopicsAndData {
  logs: ReadonlyArray<{ topics: ReadonlyArray<string>; data: string }>
}

/**
 * Pure and independently testable: given a real transaction receipt,
 * finds the UID EAS assigned. Exported so a test can hand it a fake
 * receipt directly, without needing a live chain or a mocked SDK.
 */
export function extractAttestedUID(
  receipt: LogsWithTopicsAndData | null,
  expectedAttester: string,
  expectedSchemaUID: string
): `0x${string}` | undefined {
  if (!receipt) return undefined
  const iface = new Interface(EAS_ATTESTED_EVENT_ABI)
  for (const log of receipt.logs) {
    let parsed
    try {
      parsed = iface.parseLog(log)
    } catch {
      continue // not this event — every other log in the receipt is expected to fail parsing here
    }
    if (
      parsed &&
      parsed.name === 'Attested' &&
      (parsed.args.attester as string).toLowerCase() === expectedAttester.toLowerCase() &&
      (parsed.args.schemaUID as string).toLowerCase() === expectedSchemaUID.toLowerCase()
    ) {
      return parsed.args.uid as `0x${string}`
    }
  }
  return undefined
}

/**
 * All Soneium/EAS-specific logic lives here — everything outside this
 * file talks to BlockchainAdapter's interface only.
 *
 * The EAS SDK's `.connect()` expects an ethers.js Signer/Provider, not
 * a viem client, even though viem is one of its own dependencies
 * internally. This adapter goes through the SDK's official path via
 * ethers rather than hand-rolling contract calls against the
 * SchemaRegistry/EAS ABIs; viem remains the general-purpose client
 * elsewhere (config, RPC checks).
 *
 * This class takes an already-constructed Signer from a SignerService
 * implementation (EnvSignerService for Minato/dev, a KMS-backed one for
 * Mainnet later) rather than building its own Wallet, so signer
 * rotation and secure key storage don't require rewriting this adapter.
 *
 * The adapter resolves schemaUID/attesterAddress from the `environment`
 * it's constructed with (default 'minato'), via getEnvironmentConfig() —
 * never from the Minato-only `config` singleton. Callers must pass the
 * same environment used to build the signer, or validation runs against
 * the wrong network's config.
 */
export class SoneiumEASAdapter implements BlockchainAdapter {
  private readonly eas: EASInstance
  private readonly schemaRegistry: SchemaRegistryInstance
  private readonly envConfig: EnvironmentConfig

  constructor(
    private readonly signer: Signer,
    environment: NetworkEnvironment = 'minato'
  ) {
    this.envConfig = getEnvironmentConfig(environment)

    this.eas = new EAS(CONTRACTS.eas)
    this.eas.connect(signer)

    this.schemaRegistry = new SchemaRegistry(CONTRACTS.schemaRegistry)
    this.schemaRegistry.connect(signer)
  }

  /**
   * One-time: registers the CopySight schema on Soneium and returns the
   * resulting schemaUID. Called by scripts/registerSoneiumSchema.ts, not
   * part of the per-asset flow. Effectively irreversible once run.
   */
  async registerSchema(resolverAddress: `0x${string}` = ZERO_ADDRESS): Promise<`0x${string}`> {
    const tx = await this.schemaRegistry.register({
      schema: COPYSIGHT_ANALYSIS_SCHEMA,
      resolverAddress,
      revocable: false, // must match src/schemas/CopySightAnalysisSchema.ts
    })
    const schemaUID = await tx.wait()
    return schemaUID as `0x${string}`
  }

  async createAttestation(
    input: AttestationInput
  ): Promise<{ transactionHash: `0x${string}`; uid?: `0x${string}` }> {
    if (!this.envConfig.schemaUID) {
      throw new Error('COPYSIGHT_SCHEMA_UID is not set — register the schema first.')
    }

    const encodedData = encodeAttestationData(input)

    // Transient RPC failures shouldn't immediately fail the whole
    // attestation — retry the submission with backoff first.
    const tx = await withRetry(() =>
      this.eas.attest({
        schema: this.envConfig.schemaUID,
        data: {
          recipient: input.recipient ?? ZERO_ADDRESS,
          expirationTime: 0n,
          revocable: false, // must match the registered schema's own flag
          refUID: input.refUID ?? ZERO_BYTES32,
          data: encodedData,
        },
      })
    )

    const uid = await tx.wait()

    return {
      transactionHash: tx.receipt?.hash as `0x${string}`,
      uid: uid as `0x${string}`,
    }
  }

  /**
   * Submits through RoyaltySettlement instead of calling EAS directly —
   * pays a royalty first (if a registered rights holder or known-IP
   * match exists) and only attests if that payment succeeds. Same
   * schema, same resolver path as createAttestation(); this is purely a
   * different entry point for the royalty-gated case, kept separate from
   * BlockchainAdapter's interface for now since it's Soneium/ERC20-
   * specific, not something every chain-agnostic caller needs to know
   * about.
   *
   * `this.signer` here must be an owner-authorized submitter on
   * RoyaltySettlement (the same trusted backend key already used for
   * plain attestations) — payAndRegister is not callable by just anyone,
   * since this contract is itself a resolver-authorized attester and an
   * unrestricted caller could forge "CopySight-verified" attestations
   * with no real analysis behind them. `payer` is a separate, explicit
   * parameter (not the signer) precisely so the backend can submit on a
   * real end user's behalf while the token movement is still correctly
   * attributed to that user's own wallet; the payer must have approved
   * RoyaltySettlement to spend `paymentToken` from their own wallet
   * beforehand, but never needs to submit a transaction or hold gas
   * themselves.
   *
   * Not wrapped in withRetry, unlike createAttestation(): this call
   * moves real funds and is not safely retryable — if the RPC response
   * for an already-broadcast transaction is merely lost (rather than the
   * transaction itself having failed), a blind retry could resubmit and
   * double-charge the payer.
   */
  async createAttestationWithRoyalty(
    input: AttestationInput,
    payer: `0x${string}`,
    knownIPId: `0x${string}` = ZERO_BYTES32
  ): Promise<{ transactionHash: `0x${string}`; uid?: `0x${string}` }> {
    if (!this.envConfig.schemaUID) {
      throw new Error('COPYSIGHT_SCHEMA_UID is not set — register the schema first.')
    }
    if (!this.envConfig.royaltySettlementAddress) {
      throw new Error('COPYSIGHT_ROYALTY_SETTLEMENT_ADDRESS is not set — deploy the royalty contracts first.')
    }
    if (input.recipient || input.refUID) {
      throw new Error(
        'createAttestationWithRoyalty() does not support a custom recipient or refUID yet — RoyaltySettlement always attests with recipient=address(0) and no refUID.'
      )
    }

    const contract = new Contract(this.envConfig.royaltySettlementAddress, ROYALTY_SETTLEMENT_ABI, this.signer)

    const tx = await contract.payAndRegister(
      payer,
      input.assetHash,
      input.analysisHash,
      input.copyScore,
      input.analysisVersionHash,
      knownIPId
    )
    const receipt = await tx.wait()

    return {
      transactionHash: receipt?.hash as `0x${string}`,
      uid: extractAttestedUID(receipt, this.envConfig.royaltySettlementAddress, this.envConfig.schemaUID),
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
   * was signed by a configured attester. Used by
   * src/core/verification/AttestationVerifier.ts. CopySightResolver.sol
   * enforces the same authorized-attester check on-chain at attest time;
   * this remains as a fast, no-RPC-write read-side check.
   *
   * Two addresses are valid attesters, not one: the plain backend
   * attester key (direct createAttestation() calls) and
   * RoyaltySettlement's own contract address (createAttestationWithRoyalty()
   * calls — eas.attest() there runs inside RoyaltySettlement, so
   * `attester` is that contract's address, never the backend key).
   */
  async verifyAttestation(uid: `0x${string}`): Promise<boolean> {
    const attestation = await this.getAttestation(uid)
    if (!attestation) return false
    if (attestation.schemaUID !== this.envConfig.schemaUID) return false

    const validAttesters = [this.envConfig.attesterAddress, this.envConfig.royaltySettlementAddress].filter(
      (address): address is `0x${string}` => Boolean(address)
    )
    if (validAttesters.length > 0 && !validAttesters.some((address) => attestation.attester.toLowerCase() === address.toLowerCase())) {
      return false
    }
    return !attestation.revoked
  }

  async waitForConfirmation(transactionHash: `0x${string}`): Promise<TransactionStatus> {
    if (!this.signer.provider) {
      throw new Error('Signer has no provider attached — cannot wait for confirmation.')
    }
    // Explicit timeout so a slow/stuck RPC can't hang this call
    // indefinitely; 60s is generous for Minato block times.
    //
    // With a non-zero `confirms` and a timeout, ethers' waitForTransaction
    // rejects with a TIMEOUT error when the timer fires rather than
    // resolving to null, so that case has to be caught, not read off the
    // resolved value. Returning PENDING here lets the caller
    // (BlockchainProofService) reconcile via
    // TransactionManager.recoverStuckAttestation instead of assuming
    // failure. Any other rejection is a real RPC/network error and is
    // rethrown rather than downgraded to PENDING.
    try {
      const receipt = await this.signer.provider.waitForTransaction(transactionHash, 1, 60_000)
      if (!receipt) return 'PENDING'
      return receipt.status === 1 ? 'CONFIRMED' : 'FAILED'
    } catch (err) {
      if (isError(err, 'TIMEOUT')) return 'PENDING'
      throw err
    }
  }
}
