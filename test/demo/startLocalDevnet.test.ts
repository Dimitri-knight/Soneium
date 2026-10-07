import { describe, expect, it } from 'vitest'
import { upsertEnvVars } from '../../demo/startLocalDevnet.js'

describe('upsertEnvVars', () => {
  it('replaces an existing blank KEY= line with a real value', () => {
    const result = upsertEnvVars('COPYSIGHT_SCHEMA_UID=\nCOPYSIGHT_API_KEY=real-secret\n', {
      COPYSIGHT_SCHEMA_UID: '0xabc',
    })
    expect(result).toContain('COPYSIGHT_SCHEMA_UID=0xabc')
    expect(result).toContain('COPYSIGHT_API_KEY=real-secret') // untouched
  })

  it('replaces a KEY that already has a non-empty value (e.g. the Minato default RPC)', () => {
    const result = upsertEnvVars('SONEIUM_RPC_URL=https://rpc.minato.soneium.org/\n', {
      SONEIUM_RPC_URL: 'http://127.0.0.1:8545/',
    })
    expect(result).toContain('SONEIUM_RPC_URL=http://127.0.0.1:8545/')
    expect(result).not.toContain('rpc.minato.soneium.org')
  })

  it('never touches a line whose key is not in updates', () => {
    const original = '# a comment\nCOPYSIGHT_API_KEY=real-secret\nDATABASE_URL=postgres://real\n'
    const result = upsertEnvVars(original, { SONEIUM_CHAIN_ID: '31337' })
    expect(result).toContain('COPYSIGHT_API_KEY=real-secret')
    expect(result).toContain('DATABASE_URL=postgres://real')
    expect(result).toContain('# a comment')
  })

  it('appends a key that does not exist in the original content at all, under a clearly marked section', () => {
    const result = upsertEnvVars('COPYSIGHT_API_KEY=real-secret\n', { SONEIUM_CHAIN_ID: '31337' })
    expect(result).toContain('# --- Local devnet overrides')
    expect(result).toContain('SONEIUM_CHAIN_ID=31337')
  })

  it('applies multiple updates in one call correctly', () => {
    const original = 'SONEIUM_RPC_URL=https://rpc.minato.soneium.org/\nSONEIUM_CHAIN_ID=1946\nCOPYSIGHT_SCHEMA_UID=\n'
    const result = upsertEnvVars(original, {
      SONEIUM_RPC_URL: 'http://127.0.0.1:8545/',
      SONEIUM_CHAIN_ID: '31337',
      COPYSIGHT_SCHEMA_UID: '0xabc',
    })
    expect(result).toContain('SONEIUM_RPC_URL=http://127.0.0.1:8545/')
    expect(result).toContain('SONEIUM_CHAIN_ID=31337')
    expect(result).toContain('COPYSIGHT_SCHEMA_UID=0xabc')
  })
})
