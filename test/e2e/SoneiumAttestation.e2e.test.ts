import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { sha256, stringToBytes } from 'viem'
import type { Signer } from 'ethers'
import { SoneiumEASAdapter } from '../../src/blockchain/soneium/SoneiumEASAdapter.js'
import { EnvSignerService } from '../../src/blockchain/signing/SignerService.js'
import { config } from '../../src/blockchain/soneium/config.js'
import { encodeAttestationData } from '../../src/blockchain/soneium/attestationCodec.js'
import type { AttestationInput, TransactionStatus } from '../../src/blockchain/BlockchainAdapter.js'

/**
 * Live end-to-end tests against Minato. Skipped unless
 * COPYSIGHT_ATTESTER_PRIVATE_KEY and COPYSIGHT_SCHEMA_UID are set —
 * currently blocked on Minato faucet funding and schema sign-off. Set
 * both in .env to activate; no code changes needed.
 *
 * Costs real gas, so one attestation is created in beforeAll and reused
 * across the read-only assertions below instead of per test.
 */
const isConfigured = Boolean(config.attesterPrivateKey && config.schemaUID)

describe.skipIf(!isConfigured)('SoneiumEASAdapter — live Minato E2E', () => {
  let adapter: SoneiumEASAdapter
  let input: AttestationInput
  let transactionHash: `0x${string}`
  let uid: `0x${string}`
  let confirmationStatus: TransactionStatus

  beforeAll(async () => {
    const signer = await new EnvSignerService().getSigner('minato')
    adapter = new SoneiumEASAdapter(signer)
    input = {
      assetHash: sha256(stringToBytes(`e2e-asset-${Date.now()}`)),
      analysisHash: sha256(stringToBytes('e2e-analysis')),
      copyScore: 42,
      analysisVersionHash: sha256(stringToBytes('v1.0.0-e2e')),
    }

    const result = await adapter.createAttestation(input)
    transactionHash = result.transactionHash
    uid = result.uid!
    confirmationStatus = await adapter.waitForConfirmation(transactionHash)
  }, 60_000)

  it('confirms on-chain', () => {
    expect(confirmationStatus).toBe('CONFIRMED')
  })

  it('returns a real attestation UID', () => {
    expect(uid).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('retrieves the attestation and the decoded data matches what was sent', async () => {
    const record = await adapter.getAttestation(uid)
    expect(record).not.toBeNull()
    expect(record?.data).toEqual(input)
  })

  it('verifyAttestation passes for this real, correctly-attested UID', async () => {
    expect(await adapter.verifyAttestation(uid)).toBe(true)
  })

  it('verifyAttestation fails for a UID that does not exist', async () => {
    const fakeUID = `0x${'0'.repeat(64)}` as `0x${string}`
    expect(await adapter.verifyAttestation(fakeUID)).toBe(false)
  })

  it('documents actual duplicate behavior — EAS does not dedupe identical input, produces a distinct UID', async () => {
    const second = await adapter.createAttestation(input)
    expect(second.uid).not.toBe(uid)
    // EAS doesn't dedupe — it happily attests identical data twice with
    // different UIDs. Idempotency is the caller's job (see
    // TransactionManager.computeIdempotencyKey).
  }, 60_000)
})

/**
 * Exercises SoneiumEASAdapter's branching logic (verifyAttestation,
 * getAttestation, waitForConfirmation) with a mocked eas-sdk and a fake
 * ethers Signer — no network needed, so unlike the live suite above, this
 * always runs.
 *
 * Uses `vi.doMock` + `vi.resetModules()` + a dynamic `import()` per test
 * (same pattern as SignerService.test.ts) rather than a file-level
 * `vi.mock`. A file-level mock would also replace eas-sdk for the live E2E
 * suite above whenever it actually runs, silently turning it into a mocked
 * test instead of a real one.
 */
describe('SoneiumEASAdapter — unit (mocked EAS SDK + fake signer, no network)', () => {
  const originalEnv = { ...process.env }
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
  const SCHEMA_UID = `0x${'ab'.repeat(32)}` as const
  const OTHER_SCHEMA_UID = `0x${'cd'.repeat(32)}` as const
  const ATTESTER = `0x${'11'.repeat(20)}` as const
  const OTHER_ATTESTER = `0x${'22'.repeat(20)}` as const
  const UID = `0x${'33'.repeat(32)}` as const

  const sampleInput: AttestationInput = {
    assetHash: sha256(stringToBytes('unit-test-asset')),
    analysisHash: sha256(stringToBytes('unit-test-analysis')),
    copyScore: 77,
    analysisVersionHash: sha256(stringToBytes('unit-test-v1')),
  }

  afterEach(() => {
    vi.doUnmock('@ethereum-attestation-service/eas-sdk')
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  /** Mocks eas-sdk and re-imports SoneiumEASAdapter fresh, so it picks up the current process.env. */
  async function importMockedAdapter() {
    vi.resetModules()
    const fakeEasInstances: Array<{
      connect: ReturnType<typeof vi.fn>
      attest: ReturnType<typeof vi.fn>
      getAttestation: ReturnType<typeof vi.fn>
    }> = []

    vi.doMock('@ethereum-attestation-service/eas-sdk', async () => {
      // Keep the real SchemaEncoder — attestationCodec.js is re-imported
      // fresh in this reset and needs it to encode/decode data. Only
      // EAS/SchemaRegistry (the network-talking classes) are faked.
      const actual =
        await vi.importActual<typeof import('@ethereum-attestation-service/eas-sdk')>(
          '@ethereum-attestation-service/eas-sdk'
        )
      class FakeEAS {
        connect = vi.fn()
        attest = vi.fn()
        getAttestation = vi.fn()
        constructor(_address: string) {
          fakeEasInstances.push(this)
        }
      }
      class FakeSchemaRegistry {
        connect = vi.fn()
        register = vi.fn()
        constructor(_address: string) {}
      }
      // The source imports this package via a default import + destructure,
      // not named imports (see the note atop SoneiumEASAdapter.ts), so the
      // mock must expose the same fields both at the top level and under
      // `default` — matching what Node actually gives for a CJS module.
      const mocked = {
        ...actual,
        EAS: FakeEAS,
        SchemaRegistry: FakeSchemaRegistry,
      }
      return { ...mocked, default: mocked }
    })

    const mod = await import('../../src/blockchain/soneium/SoneiumEASAdapter.js')
    return { SoneiumEASAdapter: mod.SoneiumEASAdapter, fakeEasInstances }
  }

  function fakeSignerWithProvider(waitForTransaction: (...args: unknown[]) => Promise<unknown>): Signer {
    return {
      provider: { waitForTransaction },
      getAddress: async () => ATTESTER,
    } as unknown as Signer
  }

  function fakeSignerNoProvider(): Signer {
    return { provider: undefined, getAddress: async () => ATTESTER } as unknown as Signer
  }

  function fakeAttestation(overrides: {
    attester?: string
    schema?: string
    revocationTime?: bigint
    data?: string
  } = {}) {
    return {
      uid: UID,
      attester: overrides.attester ?? ATTESTER,
      recipient: '0x0000000000000000000000000000000000dead',
      schema: overrides.schema ?? SCHEMA_UID,
      time: 1_700_000_000n,
      revocationTime: overrides.revocationTime ?? 0n,
      refUID: `0x${'00'.repeat(32)}`,
      data: overrides.data ?? encodeAttestationData(sampleInput),
    }
  }

  describe('waitForConfirmation', () => {
    it('returns PENDING when the provider call rejects with an ethers TIMEOUT error, instead of throwing', async () => {
      const { SoneiumEASAdapter } = await importMockedAdapter()
      const timeoutError = Object.assign(new Error('timeout'), { code: 'TIMEOUT' })
      const adapter = new SoneiumEASAdapter(
        fakeSignerWithProvider(async () => {
          throw timeoutError
        })
      )
      await expect(adapter.waitForConfirmation(UID)).resolves.toBe('PENDING')
    })

    it('rethrows a non-timeout rejection rather than downgrading it to PENDING', async () => {
      const { SoneiumEASAdapter } = await importMockedAdapter()
      const rpcError = new Error('connection reset')
      const adapter = new SoneiumEASAdapter(
        fakeSignerWithProvider(async () => {
          throw rpcError
        })
      )
      await expect(adapter.waitForConfirmation(UID)).rejects.toThrow('connection reset')
    })

    it('returns CONFIRMED when the receipt status is 1', async () => {
      const { SoneiumEASAdapter } = await importMockedAdapter()
      const adapter = new SoneiumEASAdapter(fakeSignerWithProvider(async () => ({ status: 1 })))
      await expect(adapter.waitForConfirmation(UID)).resolves.toBe('CONFIRMED')
    })

    it('returns FAILED when the receipt status is 0', async () => {
      const { SoneiumEASAdapter } = await importMockedAdapter()
      const adapter = new SoneiumEASAdapter(fakeSignerWithProvider(async () => ({ status: 0 })))
      await expect(adapter.waitForConfirmation(UID)).resolves.toBe('FAILED')
    })

    it('throws when the signer has no provider attached', async () => {
      const { SoneiumEASAdapter } = await importMockedAdapter()
      const adapter = new SoneiumEASAdapter(fakeSignerNoProvider())
      await expect(adapter.waitForConfirmation(UID)).rejects.toThrow(/no provider attached/)
    })
  })

  describe('getAttestation', () => {
    it('returns null when the attester is the zero address', async () => {
      const { SoneiumEASAdapter, fakeEasInstances } = await importMockedAdapter()
      const adapter = new SoneiumEASAdapter(fakeSignerWithProvider(async () => ({ status: 1 })))
      fakeEasInstances[0].getAttestation.mockResolvedValue(fakeAttestation({ attester: ZERO_ADDRESS }))
      expect(await adapter.getAttestation(UID)).toBeNull()
    })
  })

  describe('verifyAttestation', () => {
    it('returns false when the attestation is not found (attester is the zero address)', async () => {
      const { SoneiumEASAdapter, fakeEasInstances } = await importMockedAdapter()
      const adapter = new SoneiumEASAdapter(fakeSignerWithProvider(async () => ({ status: 1 })))
      fakeEasInstances[0].getAttestation.mockResolvedValue(fakeAttestation({ attester: ZERO_ADDRESS }))
      expect(await adapter.verifyAttestation(UID)).toBe(false)
    })

    it('returns false when the attestation schemaUID does not match the configured schema', async () => {
      process.env.COPYSIGHT_SCHEMA_UID = SCHEMA_UID
      const { SoneiumEASAdapter, fakeEasInstances } = await importMockedAdapter()
      const adapter = new SoneiumEASAdapter(fakeSignerWithProvider(async () => ({ status: 1 })))
      fakeEasInstances[0].getAttestation.mockResolvedValue(fakeAttestation({ schema: OTHER_SCHEMA_UID }))
      expect(await adapter.verifyAttestation(UID)).toBe(false)
    })

    it('returns false when the attester does not match config.attesterAddress (set)', async () => {
      process.env.COPYSIGHT_SCHEMA_UID = SCHEMA_UID
      process.env.COPYSIGHT_ATTESTER_ADDRESS = ATTESTER
      const { SoneiumEASAdapter, fakeEasInstances } = await importMockedAdapter()
      const adapter = new SoneiumEASAdapter(fakeSignerWithProvider(async () => ({ status: 1 })))
      fakeEasInstances[0].getAttestation.mockResolvedValue(fakeAttestation({ attester: OTHER_ATTESTER }))
      expect(await adapter.verifyAttestation(UID)).toBe(false)
    })

    it('skips the attester check and returns true when config.attesterAddress is unset', async () => {
      process.env.COPYSIGHT_SCHEMA_UID = SCHEMA_UID
      process.env.COPYSIGHT_ATTESTER_ADDRESS = ''
      const { SoneiumEASAdapter, fakeEasInstances } = await importMockedAdapter()
      const adapter = new SoneiumEASAdapter(fakeSignerWithProvider(async () => ({ status: 1 })))
      fakeEasInstances[0].getAttestation.mockResolvedValue(fakeAttestation({ attester: OTHER_ATTESTER }))
      expect(await adapter.verifyAttestation(UID)).toBe(true)
    })

    it('returns true for a correctly-attested, non-revoked attestation matching schema and attester', async () => {
      process.env.COPYSIGHT_SCHEMA_UID = SCHEMA_UID
      process.env.COPYSIGHT_ATTESTER_ADDRESS = ATTESTER
      const { SoneiumEASAdapter, fakeEasInstances } = await importMockedAdapter()
      const adapter = new SoneiumEASAdapter(fakeSignerWithProvider(async () => ({ status: 1 })))
      fakeEasInstances[0].getAttestation.mockResolvedValue(fakeAttestation())
      expect(await adapter.verifyAttestation(UID)).toBe(true)
    })

    it('returns false when the attestation has been revoked', async () => {
      process.env.COPYSIGHT_SCHEMA_UID = SCHEMA_UID
      process.env.COPYSIGHT_ATTESTER_ADDRESS = ATTESTER
      const { SoneiumEASAdapter, fakeEasInstances } = await importMockedAdapter()
      const adapter = new SoneiumEASAdapter(fakeSignerWithProvider(async () => ({ status: 1 })))
      fakeEasInstances[0].getAttestation.mockResolvedValue(fakeAttestation({ revocationTime: 123n }))
      expect(await adapter.verifyAttestation(UID)).toBe(false)
    })

    it('returns true for an attestation whose attester is RoyaltySettlement, not the plain attester key', async () => {
      // createAttestationWithRoyalty() attests from inside RoyaltySettlement
      // itself, so `attester` is that contract's address, never
      // config.attesterAddress — verifyAttestation must accept both.
      process.env.COPYSIGHT_SCHEMA_UID = SCHEMA_UID
      process.env.COPYSIGHT_ATTESTER_ADDRESS = ATTESTER
      process.env.COPYSIGHT_ROYALTY_SETTLEMENT_ADDRESS = OTHER_ATTESTER
      const { SoneiumEASAdapter, fakeEasInstances } = await importMockedAdapter()
      const adapter = new SoneiumEASAdapter(fakeSignerWithProvider(async () => ({ status: 1 })))
      fakeEasInstances[0].getAttestation.mockResolvedValue(fakeAttestation({ attester: OTHER_ATTESTER }))
      expect(await adapter.verifyAttestation(UID)).toBe(true)
    })

    it('returns false when the attester matches neither the plain attester nor royaltySettlementAddress', async () => {
      const someUnrelatedAddress = `0x${'ee'.repeat(20)}`
      process.env.COPYSIGHT_SCHEMA_UID = SCHEMA_UID
      process.env.COPYSIGHT_ATTESTER_ADDRESS = ATTESTER
      process.env.COPYSIGHT_ROYALTY_SETTLEMENT_ADDRESS = OTHER_ATTESTER
      const { SoneiumEASAdapter, fakeEasInstances } = await importMockedAdapter()
      const adapter = new SoneiumEASAdapter(fakeSignerWithProvider(async () => ({ status: 1 })))
      fakeEasInstances[0].getAttestation.mockResolvedValue(fakeAttestation({ attester: someUnrelatedAddress }))
      expect(await adapter.verifyAttestation(UID)).toBe(false)
    })
  })

  describe('createAttestation', () => {
    it('retries a transient eas.attest() failure via withRetry and eventually succeeds', async () => {
      process.env.COPYSIGHT_SCHEMA_UID = SCHEMA_UID
      const { SoneiumEASAdapter, fakeEasInstances } = await importMockedAdapter()
      const adapter = new SoneiumEASAdapter(fakeSignerWithProvider(async () => ({ status: 1 })))

      const fakeTx = { wait: async () => UID, receipt: { hash: `0x${'44'.repeat(32)}` } }
      fakeEasInstances[0].attest
        .mockRejectedValueOnce(new Error('transient RPC error'))
        .mockResolvedValueOnce(fakeTx)

      const result = await adapter.createAttestation(sampleInput)
      expect(result.uid).toBe(UID)
      expect(fakeEasInstances[0].attest).toHaveBeenCalledTimes(2)
    })

    it('throws when COPYSIGHT_SCHEMA_UID is not configured for the adapter\'s environment', async () => {
      process.env.COPYSIGHT_SCHEMA_UID = ''
      const { SoneiumEASAdapter } = await importMockedAdapter()
      const adapter = new SoneiumEASAdapter(fakeSignerWithProvider(async () => ({ status: 1 })))
      await expect(adapter.createAttestation(sampleInput)).rejects.toThrow(/COPYSIGHT_SCHEMA_UID is not set/)
    })
  })

  describe('createAttestationWithRoyalty — upfront guards (no live chain needed, fails before any contract call)', () => {
    const ROYALTY_SETTLEMENT_ADDRESS = `0x${'55'.repeat(20)}`

    it('throws when COPYSIGHT_SCHEMA_UID is not configured', async () => {
      process.env.COPYSIGHT_SCHEMA_UID = ''
      process.env.COPYSIGHT_ROYALTY_SETTLEMENT_ADDRESS = ROYALTY_SETTLEMENT_ADDRESS
      const { SoneiumEASAdapter } = await importMockedAdapter()
      const adapter = new SoneiumEASAdapter(fakeSignerWithProvider(async () => ({ status: 1 })))
      await expect(adapter.createAttestationWithRoyalty(sampleInput, ATTESTER)).rejects.toThrow(/COPYSIGHT_SCHEMA_UID is not set/)
    })

    it('throws when COPYSIGHT_ROYALTY_SETTLEMENT_ADDRESS is not configured', async () => {
      process.env.COPYSIGHT_SCHEMA_UID = SCHEMA_UID
      process.env.COPYSIGHT_ROYALTY_SETTLEMENT_ADDRESS = ''
      const { SoneiumEASAdapter } = await importMockedAdapter()
      const adapter = new SoneiumEASAdapter(fakeSignerWithProvider(async () => ({ status: 1 })))
      await expect(adapter.createAttestationWithRoyalty(sampleInput, ATTESTER)).rejects.toThrow(
        /COPYSIGHT_ROYALTY_SETTLEMENT_ADDRESS is not set/
      )
    })

    it('throws rather than silently dropping a custom recipient — RoyaltySettlement always attests to address(0)', async () => {
      process.env.COPYSIGHT_SCHEMA_UID = SCHEMA_UID
      process.env.COPYSIGHT_ROYALTY_SETTLEMENT_ADDRESS = ROYALTY_SETTLEMENT_ADDRESS
      const { SoneiumEASAdapter } = await importMockedAdapter()
      const adapter = new SoneiumEASAdapter(fakeSignerWithProvider(async () => ({ status: 1 })))
      await expect(
        adapter.createAttestationWithRoyalty({ ...sampleInput, recipient: OTHER_ATTESTER }, ATTESTER)
      ).rejects.toThrow(/does not support a custom recipient or refUID/)
    })

    it('throws rather than silently dropping a refUID — RoyaltySettlement never supersedes a prior attestation', async () => {
      process.env.COPYSIGHT_SCHEMA_UID = SCHEMA_UID
      process.env.COPYSIGHT_ROYALTY_SETTLEMENT_ADDRESS = ROYALTY_SETTLEMENT_ADDRESS
      const { SoneiumEASAdapter } = await importMockedAdapter()
      const adapter = new SoneiumEASAdapter(fakeSignerWithProvider(async () => ({ status: 1 })))
      await expect(
        adapter.createAttestationWithRoyalty({ ...sampleInput, refUID: UID }, ATTESTER)
      ).rejects.toThrow(/does not support a custom recipient or refUID/)
    })
  })

  describe('environment selection', () => {
    it('validates schemaUID against the environment the adapter was constructed with, not always Minato', async () => {
      // Mainnet and Minato configured with different schemaUIDs — the
      // 'mainnet' adapter must validate against Mainnet's, not fall back
      // to Minato's.
      process.env.COPYSIGHT_SCHEMA_UID = OTHER_SCHEMA_UID
      process.env.COPYSIGHT_MAINNET_SCHEMA_UID = SCHEMA_UID
      const { SoneiumEASAdapter, fakeEasInstances } = await importMockedAdapter()
      const adapter = new SoneiumEASAdapter(fakeSignerWithProvider(async () => ({ status: 1 })), 'mainnet')
      fakeEasInstances[0].getAttestation.mockResolvedValue(fakeAttestation({ schema: SCHEMA_UID }))
      expect(await adapter.verifyAttestation(UID)).toBe(true)
    })
  })
})
