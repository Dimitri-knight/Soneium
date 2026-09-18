import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NonceManager, Wallet } from 'ethers'

/**
 * config.ts computes its `environments` object once, at module load,
 * from process.env — same pattern used throughout this codebase. To
 * test different env-var scenarios in one run, each test resets the
 * module registry and re-imports fresh with process.env already set,
 * rather than mutating a cached config object.
 *
 * Uses Wallet.createRandom() to generate a throwaway key/address pair
 * per test, rather than hardcoding a "well-known" test key from memory
 * — sidesteps any risk of a memorized key being subtly wrong and the
 * test silently checking against an incorrect expected address.
 */
describe('EnvSignerService', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('throws a clear error when no attester key is configured for the environment', async () => {
    process.env.COPYSIGHT_MAINNET_ATTESTER_PRIVATE_KEY = ''
    process.env.SONEIUM_MAINNET_RPC_URL = 'https://example.invalid'
    const { EnvSignerService } = await import('../../../src/blockchain/signing/SignerService.js')
    const service = new EnvSignerService()
    await expect(service.getSigner('mainnet')).rejects.toThrow(/No attester private key configured/)
  }, 15_000)

  it('throws a clear error when no RPC URL is configured for the environment', async () => {
    const throwaway = Wallet.createRandom()
    process.env.COPYSIGHT_MAINNET_ATTESTER_PRIVATE_KEY = throwaway.privateKey
    process.env.SONEIUM_MAINNET_RPC_URL = ''
    const { EnvSignerService } = await import('../../../src/blockchain/signing/SignerService.js')
    const service = new EnvSignerService()
    await expect(service.getSigner('mainnet')).rejects.toThrow(/No RPC URL configured/)
  }, 15_000)

  it('derives the correct address from a configured private key', async () => {
    const throwaway = Wallet.createRandom()
    process.env.COPYSIGHT_ATTESTER_PRIVATE_KEY = throwaway.privateKey
    process.env.SONEIUM_RPC_URL = 'https://rpc.minato.soneium.org/'
    const { EnvSignerService } = await import('../../../src/blockchain/signing/SignerService.js')
    const service = new EnvSignerService()
    const address = await service.getAddress('minato')
    expect(address.toLowerCase()).toBe(throwaway.address.toLowerCase())
  }, 15_000)

  it('wraps the returned signer in ethers own NonceManager — satisfies nonce management without hand-rolling it', async () => {
    const throwaway = Wallet.createRandom()
    process.env.COPYSIGHT_ATTESTER_PRIVATE_KEY = throwaway.privateKey
    process.env.SONEIUM_RPC_URL = 'https://rpc.minato.soneium.org/'
    const { EnvSignerService } = await import('../../../src/blockchain/signing/SignerService.js')
    const service = new EnvSignerService()
    const signer = await service.getSigner('minato')
    expect(signer).toBeInstanceOf(NonceManager)
  }, 15_000)

  it('reuses the same provider across repeated calls for the same environment rather than reconnecting each time', async () => {
    const throwaway = Wallet.createRandom()
    process.env.COPYSIGHT_ATTESTER_PRIVATE_KEY = throwaway.privateKey
    process.env.SONEIUM_RPC_URL = 'https://rpc.minato.soneium.org/'
    const { EnvSignerService } = await import('../../../src/blockchain/signing/SignerService.js')
    const service = new EnvSignerService()
    const first = (await service.getSigner('minato')) as NonceManager
    const second = (await service.getSigner('minato')) as NonceManager
    expect(first.provider).toBe(second.provider)
  }, 15_000)

  it('uses distinct provider instances for different environments rather than sharing one across networks', async () => {
    const minatoKey = Wallet.createRandom()
    const mainnetKey = Wallet.createRandom()
    process.env.COPYSIGHT_ATTESTER_PRIVATE_KEY = minatoKey.privateKey
    process.env.SONEIUM_RPC_URL = 'https://rpc.minato.soneium.org/'
    process.env.COPYSIGHT_MAINNET_ATTESTER_PRIVATE_KEY = mainnetKey.privateKey
    process.env.SONEIUM_MAINNET_RPC_URL = 'https://example.invalid'
    const { EnvSignerService } = await import('../../../src/blockchain/signing/SignerService.js')
    const service = new EnvSignerService()
    const minatoSigner = (await service.getSigner('minato')) as NonceManager
    const mainnetSigner = (await service.getSigner('mainnet')) as NonceManager
    expect(minatoSigner.provider).not.toBe(mainnetSigner.provider)
  }, 15_000)

  it('logs signer activity once per environment on construction, not again on a cached repeat call', async () => {
    const throwaway = Wallet.createRandom()
    process.env.COPYSIGHT_ATTESTER_PRIVATE_KEY = throwaway.privateKey
    process.env.SONEIUM_RPC_URL = 'https://rpc.minato.soneium.org/'
    const { EnvSignerService } = await import('../../../src/blockchain/signing/SignerService.js')
    const { logger } = await import('../../../src/core/logging/logger.js')
    const infoSpy = vi.spyOn(logger, 'info')

    const service = new EnvSignerService()
    await service.getSigner('minato')
    expect(infoSpy).toHaveBeenCalledWith(
      'signer_service.signer_constructed',
      expect.objectContaining({ environment: 'minato', address: throwaway.address })
    )
    expect(infoSpy).toHaveBeenCalledTimes(1)

    await service.getSigner('minato')
    expect(infoSpy).toHaveBeenCalledTimes(1) // still 1 — cached, no re-log
    infoSpy.mockRestore()
  }, 15_000)

  it('returns the SAME Signer/NonceManager instance for repeated calls to the same environment, so concurrent submissions actually serialize through one shared nonce sequence', async () => {
    // This documents and locks in the fix for the nonce-collision risk:
    // two independently-constructed NonceManagers for the same address
    // would each track their own in-memory nonce and could collide. A
    // single cached instance per environment is what the class's own
    // doc comment claims ("concurrent submissions from the same address
    // get serialized, correctly-sequenced nonces automatically").
    const throwaway = Wallet.createRandom()
    process.env.COPYSIGHT_ATTESTER_PRIVATE_KEY = throwaway.privateKey
    process.env.SONEIUM_RPC_URL = 'https://rpc.minato.soneium.org/'
    const { EnvSignerService } = await import('../../../src/blockchain/signing/SignerService.js')
    const service = new EnvSignerService()
    const first = await service.getSigner('minato')
    const second = await service.getSigner('minato')
    expect(first).toBe(second)
  }, 15_000)
})
