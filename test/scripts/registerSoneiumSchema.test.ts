import { describe, expect, it } from 'vitest'
import { buildSchemaDeploymentRecord } from '../../scripts/registerSoneiumSchema.js'
import type { SchemaDeploymentFields } from '../../scripts/registerSoneiumSchema.js'

const fields: SchemaDeploymentFields = {
  chainId: 1946,
  rpcUrl: 'https://rpc.minato.soneium.org/',
  easAddress: '0x4200000000000000000000000000000000000021',
  schemaRegistryAddress: '0x4200000000000000000000000000000000000020',
  schemaUID: '0xschemauid',
  schemaName: 'CopySight_ipAnalysis',
  schema: 'bytes32 assetHash, bytes32 analysisHash, uint8 copyScore, bytes32 analysisVersionHash',
  revocable: false,
  resolverAddress: '0xNewResolver',
  attesterAddress: '0xAttester',
  registeredAt: '2026-01-01T00:00:00.000Z',
}

describe('buildSchemaDeploymentRecord', () => {
  it('builds a full record when there is no existing deployments/minato.json', () => {
    expect(buildSchemaDeploymentRecord({}, fields)).toEqual(fields)
  })

  it('overrides an existing resolverAddress when this registration passed a fresh one', () => {
    const existing = { resolverAddress: '0xPriorResolver' }
    const record = buildSchemaDeploymentRecord(existing, fields)
    expect(record.resolverAddress).toBe('0xNewResolver')
  })

  it('preserves an existing resolverAddress when this run registered with no resolver', () => {
    const existing = { resolverAddress: '0xPriorResolver' }
    const record = buildSchemaDeploymentRecord(existing, { ...fields, resolverAddress: undefined })
    expect(record.resolverAddress).toBe('0xPriorResolver')
  })

  it('falls back to null when neither this run nor the existing record has a resolverAddress', () => {
    const record = buildSchemaDeploymentRecord({}, { ...fields, resolverAddress: undefined })
    expect(record.resolverAddress).toBeNull()
  })

  it('preserves unrelated existing fields (e.g. written earlier by deployCopySightResolver.ts)', () => {
    const existing = {
      resolverOwner: '0xOwner',
      resolverInitialAttester: '0xAttester',
      resolverDeployedAt: '2025-06-01T00:00:00.000Z',
    }
    const record = buildSchemaDeploymentRecord(existing, fields)
    expect(record.resolverOwner).toBe('0xOwner')
    expect(record.resolverInitialAttester).toBe('0xAttester')
    expect(record.resolverDeployedAt).toBe('2025-06-01T00:00:00.000Z')
    expect(record.schemaUID).toBe(fields.schemaUID)
  })
})
