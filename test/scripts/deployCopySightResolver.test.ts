import { describe, expect, it } from 'vitest'
import {
  buildResolverDeploymentRecord,
  validateDeployPreconditions,
} from '../../scripts/deployCopySightResolver.js'
import type { ResolverDeploymentFields } from '../../scripts/deployCopySightResolver.js'

describe('validateDeployPreconditions', () => {
  const valid = {
    attesterAddress: '0xAttester',
    artifactExists: true,
    existingResolverAddress: '',
    force: false,
  }

  it('passes when the artifact exists, the attester is configured, and no resolver is already deployed', () => {
    expect(validateDeployPreconditions(valid)).toEqual({ ok: true, errors: [] })
  })

  it('fails when the compiled artifact is missing', () => {
    const result = validateDeployPreconditions({ ...valid, artifactExists: false })
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('forge build'))).toBe(true)
  })

  it('fails when COPYSIGHT_ATTESTER_ADDRESS is not configured', () => {
    const result = validateDeployPreconditions({ ...valid, attesterAddress: '' })
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('COPYSIGHT_ATTESTER_ADDRESS'))).toBe(true)
  })

  it('fails when a resolver is already deployed and force is not set', () => {
    const result = validateDeployPreconditions({ ...valid, existingResolverAddress: '0xOldResolver' })
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('0xOldResolver'))).toBe(true)
  })

  it('allows deploying a replacement resolver when force is explicitly set', () => {
    const result = validateDeployPreconditions({
      ...valid,
      existingResolverAddress: '0xOldResolver',
      force: true,
    })
    expect(result).toEqual({ ok: true, errors: [] })
  })

  it('collects every failing check at once rather than stopping at the first', () => {
    const result = validateDeployPreconditions({
      attesterAddress: '',
      artifactExists: false,
      existingResolverAddress: '0xOldResolver',
      force: false,
    })
    expect(result.ok).toBe(false)
    expect(result.errors).toHaveLength(3)
  })
})

describe('buildResolverDeploymentRecord', () => {
  const fields: ResolverDeploymentFields = {
    resolverAddress: '0xNewResolver',
    resolverOwner: '0xOwner',
    resolverInitialAttester: '0xAttester',
    resolverDeployedAt: '2026-01-01T00:00:00.000Z',
  }

  it('builds a full record when there is no existing deployments/minato.json', () => {
    expect(buildResolverDeploymentRecord({}, fields)).toEqual(fields)
  })

  it('preserves unrelated existing fields (e.g. a schemaUID written earlier by registerSoneiumSchema.ts)', () => {
    const existing = { schemaUID: '0xSchema', schemaName: 'CopySight_ipAnalysis' }
    const record = buildResolverDeploymentRecord(existing, fields)
    expect(record.schemaUID).toBe('0xSchema')
    expect(record.schemaName).toBe('CopySight_ipAnalysis')
    expect(record.resolverAddress).toBe('0xNewResolver')
  })

  it('overrides a stale resolverAddress from an existing record with the freshly deployed one', () => {
    const existing = { resolverAddress: '0xStaleResolver' }
    const record = buildResolverDeploymentRecord(existing, fields)
    expect(record.resolverAddress).toBe('0xNewResolver')
  })
})
