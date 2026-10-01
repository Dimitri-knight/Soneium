import { describe, expect, it } from 'vitest'
import {
  buildRoyaltyDeploymentRecord,
  shouldDeployNewRightsRegistry,
  validateRoyaltyDeployPreconditions,
} from '../../scripts/deployRoyaltyContracts.js'
import type { RoyaltyDeploymentFields } from '../../scripts/deployRoyaltyContracts.js'

describe('validateRoyaltyDeployPreconditions', () => {
  const valid = {
    attesterAddress: '0xAttester',
    resolverAddress: '0xResolver',
    schemaUID: '0xSchema',
    rightsRegistryArtifactExists: true,
    royaltySettlementArtifactExists: true,
    resolverArtifactExists: true,
    existingRoyaltySettlementAddress: '',
    force: false,
  }

  it('passes when all artifacts exist, the resolver/schema/attester are configured, and nothing is already deployed', () => {
    expect(validateRoyaltyDeployPreconditions(valid)).toEqual({ ok: true, errors: [] })
  })

  it('fails when any compiled artifact is missing', () => {
    const result = validateRoyaltyDeployPreconditions({ ...valid, rightsRegistryArtifactExists: false })
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('forge build'))).toBe(true)
  })

  it('fails when the CopySightResolver artifact specifically is missing, even though main() reads it unconditionally', () => {
    const result = validateRoyaltyDeployPreconditions({ ...valid, resolverArtifactExists: false })
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('forge build'))).toBe(true)
  })

  it('fails when COPYSIGHT_ATTESTER_ADDRESS is not configured', () => {
    const result = validateRoyaltyDeployPreconditions({ ...valid, attesterAddress: '' })
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('COPYSIGHT_ATTESTER_ADDRESS'))).toBe(true)
  })

  it('fails when the resolver has not been deployed yet', () => {
    const result = validateRoyaltyDeployPreconditions({ ...valid, resolverAddress: '' })
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('deploy:resolver'))).toBe(true)
  })

  it('fails when the schema has not been registered yet', () => {
    const result = validateRoyaltyDeployPreconditions({ ...valid, schemaUID: '' })
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('register:schema'))).toBe(true)
  })

  it('fails when RoyaltySettlement is already deployed and force is not set', () => {
    const result = validateRoyaltyDeployPreconditions({ ...valid, existingRoyaltySettlementAddress: '0xOldSettlement' })
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('0xOldSettlement'))).toBe(true)
  })

  it('allows deploying a replacement when force is explicitly set', () => {
    const result = validateRoyaltyDeployPreconditions({
      ...valid,
      existingRoyaltySettlementAddress: '0xOldSettlement',
      force: true,
    })
    expect(result).toEqual({ ok: true, errors: [] })
  })

  it('collects every failing check at once rather than stopping at the first', () => {
    const result = validateRoyaltyDeployPreconditions({
      attesterAddress: '',
      resolverAddress: '',
      schemaUID: '',
      rightsRegistryArtifactExists: false,
      royaltySettlementArtifactExists: false,
      resolverArtifactExists: false,
      existingRoyaltySettlementAddress: '0xOldSettlement',
      force: false,
    })
    expect(result.ok).toBe(false)
    expect(result.errors).toHaveLength(5)
  })
})

describe('shouldDeployNewRightsRegistry', () => {
  it('deploys a new one when none is configured yet', () => {
    expect(shouldDeployNewRightsRegistry('')).toBe(true)
  })

  it('reuses an existing one rather than orphaning its already-registered creators', () => {
    expect(shouldDeployNewRightsRegistry('0xExistingRegistry')).toBe(false)
  })
})

describe('buildRoyaltyDeploymentRecord', () => {
  const fields: RoyaltyDeploymentFields = {
    rightsRegistryAddress: '0xNewRegistry',
    royaltySettlementAddress: '0xNewSettlement',
    royaltyOwner: '0xOwner',
    royaltySubmitter: '0xSubmitter',
    royaltyDeployedAt: '2026-01-01T00:00:00.000Z',
  }

  it('builds a full record when there is no existing deployments/minato.json', () => {
    expect(buildRoyaltyDeploymentRecord({}, fields)).toEqual(fields)
  })

  it('preserves unrelated existing fields written by earlier deploy scripts (schemaUID, resolverAddress)', () => {
    const existing = { schemaUID: '0xSchema', resolverAddress: '0xResolver' }
    const record = buildRoyaltyDeploymentRecord(existing, fields)
    expect(record.schemaUID).toBe('0xSchema')
    expect(record.resolverAddress).toBe('0xResolver')
    expect(record.rightsRegistryAddress).toBe('0xNewRegistry')
    expect(record.royaltySettlementAddress).toBe('0xNewSettlement')
  })

  it('overrides stale royalty addresses from an existing record with the freshly deployed ones', () => {
    const existing = { rightsRegistryAddress: '0xStaleRegistry', royaltySettlementAddress: '0xStaleSettlement' }
    const record = buildRoyaltyDeploymentRecord(existing, fields)
    expect(record.rightsRegistryAddress).toBe('0xNewRegistry')
    expect(record.royaltySettlementAddress).toBe('0xNewSettlement')
  })
})
