// Namespace import + resolveEasSdkModule — see easSdkInterop.ts for why.
// Types are imported separately since type-only imports are erased at
// compile time and don't go through runtime module resolution. `EAS`/
// `SchemaRegistry` are used below both as values (the destructured
// constructors) and as instance types (field annotations).
import * as EasSdkNs from '@ethereum-attestation-service/eas-sdk'
import type { EAS as EASInstance, SchemaRegistry as SchemaRegistryInstance } from '@ethereum-attestation-service/eas-sdk'
import { resolveEasSdkModule } from './easSdkInterop.js'
import { isError, type Signer } from 'ethers'
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
   * was signed by the configured attester. Used by
   * src/core/verification/AttestationVerifier.ts. CopySightResolver.sol
   * enforces the same authorized-attester check on-chain at attest time;
   * this remains as a fast, no-RPC-write read-side check.
   */
  async verifyAttestation(uid: `0x${string}`): Promise<boolean> {
    const attestation = await this.getAttestation(uid)
    if (!attestation) return false
    if (attestation.schemaUID !== this.envConfig.schemaUID) return false
    if (
      this.envConfig.attesterAddress &&
      attestation.attester.toLowerCase() !== this.envConfig.attesterAddress.toLowerCase()
    ) {
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
