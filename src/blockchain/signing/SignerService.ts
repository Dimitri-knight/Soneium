import { JsonRpcProvider, NonceManager, Wallet, type Signer } from 'ethers'
import { getEnvironmentConfig, type NetworkEnvironment } from '../soneium/config.js'
import { logger } from '../../core/logging/logger.js'

export interface SignerService {
  getSigner(environment: NetworkEnvironment): Promise<Signer>
  getAddress(environment: NetworkEnvironment): Promise<string>
}

/**
 * Local-private-key implementation, reading from per-environment env
 * vars (COPYSIGHT_ATTESTER_PRIVATE_KEY for Minato,
 * COPYSIGHT_MAINNET_ATTESTER_PRIVATE_KEY for Mainnet — see config.ts).
 * Signers are wrapped in ethers' NonceManager so concurrent submissions
 * from the same address get correctly-sequenced nonces automatically.
 *
 * That serialization only holds within a single NonceManager instance —
 * two separate instances for the same address track nonces
 * independently and could collide. So the Signer/NonceManager is cached
 * per environment and reused across calls to getSigner() rather than
 * reconstructed each time.
 *
 * This is fine for Minato/dev but not the real Mainnet answer — a raw
 * private key in an env var is exactly what secure key storage is meant
 * to replace. Mainnet should get a KmsSignerService implementing this
 * same interface; because this returns `Signer` rather than `Wallet`,
 * nothing else in this codebase needs to change when that happens.
 */
export class EnvSignerService implements SignerService {
  private readonly providers = new Map<NetworkEnvironment, JsonRpcProvider>()
  private readonly signers = new Map<NetworkEnvironment, Signer>()

  async getSigner(environment: NetworkEnvironment): Promise<Signer> {
    const cachedSigner = this.signers.get(environment)
    if (cachedSigner) return cachedSigner

    const envConfig = getEnvironmentConfig(environment)

    if (!envConfig.attesterPrivateKey) {
      throw new Error(
        `No attester private key configured for "${environment}". ` +
          (environment === 'minato'
            ? 'Set COPYSIGHT_ATTESTER_PRIVATE_KEY.'
            : 'Set COPYSIGHT_MAINNET_ATTESTER_PRIVATE_KEY — and confirm whether a KMS-backed signer should be used instead before going live on Mainnet.')
      )
    }
    if (!envConfig.rpcUrl) {
      throw new Error(`No RPC URL configured for "${environment}".`)
    }

    let provider = this.providers.get(environment)
    if (!provider) {
      provider = new JsonRpcProvider(envConfig.rpcUrl, envConfig.chainId)
      this.providers.set(environment, provider)
    }

    const wallet = new Wallet(envConfig.attesterPrivateKey, provider)
    const signer = new NonceManager(wallet)
    this.signers.set(environment, signer)

    // Logged once per environment (this branch only runs on a cache
    // miss) so an operator can see which address is active where,
    // without a log line per attestation.
    logger.info('signer_service.signer_constructed', { environment, address: wallet.address, rpcUrl: envConfig.rpcUrl })

    return signer
  }

  async getAddress(environment: NetworkEnvironment): Promise<string> {
    const signer = await this.getSigner(environment)
    return signer.getAddress()
  }
}
