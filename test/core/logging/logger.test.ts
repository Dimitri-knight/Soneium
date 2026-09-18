import { afterEach, describe, expect, it, vi } from 'vitest'
import { logger } from '../../../src/core/logging/logger.js'

function lastLoggedEntry(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const line = spy.mock.calls[spy.mock.calls.length - 1]?.[0] as string
  return JSON.parse(line) as Record<string, unknown>
}

describe('logger', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('routes info to console.log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    logger.info('something happened')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('routes warn to console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logger.warn('careful')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('routes error to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logger.error('it broke')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('emits a JSON line with timestamp, level, message, and context fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    logger.info('op started', { requestId: 'abc-123' })

    const entry = lastLoggedEntry(spy)
    expect(entry.level).toBe('info')
    expect(entry.message).toBe('op started')
    expect(entry.requestId).toBe('abc-123')
    expect(typeof entry.timestamp).toBe('string')
    expect(new Date(entry.timestamp as string).toISOString()).toBe(entry.timestamp)
  })

  it('does not let a context field named message/level/timestamp override the envelope', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logger.error('op failed', { message: 'x', level: 'FAKE', timestamp: 'not-a-real-timestamp' })

    const entry = lastLoggedEntry(spy)
    expect(entry.level).toBe('error')
    expect(entry.message).toBe('op failed')
    expect(entry.timestamp).not.toBe('not-a-real-timestamp')
    expect(new Date(entry.timestamp as string).toISOString()).toBe(entry.timestamp)
  })
})
