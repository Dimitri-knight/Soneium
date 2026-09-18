import { afterEach, describe, expect, it, vi } from 'vitest'
import { CopySightApiError, CopySightClient } from '../../demo/CopySightClient.js'

/**
 * The real end-to-end demo run only ever hit 200 OK (6/6 samples
 * succeeded) — meaning CopySightClient's error handling, written
 * against the documented 401/422/429/500/503 shapes, had never actually
 * been exercised. These tests close that gap with a mocked `fetch`,
 * since triggering a real API error on demand isn't practical.
 */
function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('CopySightClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the parsed response on a successful 200', async () => {
    const body = { contains_face: false, detected_ips: [] }
    mockFetch(200, body)
    const result = await new CopySightClient('test-key').verify(new Uint8Array([1, 2, 3]), 'test.jpg')
    expect(result).toEqual(body)
  })

  it('posts to {baseUrl}/verify with the API key on the X-API-Key header', async () => {
    const fetchMock = mockFetch(200, { contains_face: false, detected_ips: [] })
    await new CopySightClient('my-key', 'https://example.test/v1').verify(new Uint8Array([1]), 'a.jpg')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://example.test/v1/verify')
    expect(init.method).toBe('POST')
    expect(init.headers['X-API-Key']).toBe('my-key')
  })

  it('throws CopySightApiError with status 401 on an invalid key', async () => {
    mockFetch(401, { error: 'Unauthorized', message: 'Invalid API key' })
    await expect(new CopySightClient('bad-key').verify(new Uint8Array([1]), 'a.jpg')).rejects.toMatchObject({
      status: 401,
    })
  })

  it('throws CopySightApiError on a 422 (media could not be analyzed)', async () => {
    mockFetch(422, { error: 'Unprocessable Entity', message: 'could not be analyzed' })
    await expect(new CopySightClient('key').verify(new Uint8Array([1]), 'a.jpg')).rejects.toThrow(CopySightApiError)
  })

  it('parses retry_after from the response body on a 429', async () => {
    mockFetch(429, { error: 'Too Many Requests', retry_after: 60 })
    await expect(new CopySightClient('key').verify(new Uint8Array([1]), 'a.jpg')).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 60,
    })
  })

  it('prefers the Retry-After header over the body when both are present', async () => {
    mockFetch(429, { retry_after: 60 }, { 'retry-after': '30' })
    await expect(new CopySightClient('key').verify(new Uint8Array([1]), 'a.jpg')).rejects.toMatchObject({
      retryAfterSeconds: 30,
    })
  })

  it('has no retryAfterSeconds when neither the header nor the body provide one (e.g. a plain 500)', async () => {
    mockFetch(500, { error: 'Internal Server Error' })
    await expect(new CopySightClient('key').verify(new Uint8Array([1]), 'a.jpg')).rejects.toMatchObject({
      status: 500,
      retryAfterSeconds: undefined,
    })
  })

  it('does not throw while parsing an unparseable error body — falls back to an empty object rather than crashing', async () => {
    const fn = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: new Headers(),
      json: async () => {
        throw new Error('not json')
      },
    })
    vi.stubGlobal('fetch', fn)

    await expect(new CopySightClient('key').verify(new Uint8Array([1]), 'a.jpg')).rejects.toMatchObject({
      status: 503,
      body: {},
    })
  })

  it('sends advanced=true only when explicitly requested, omits it otherwise', async () => {
    const fetchMock = mockFetch(200, { contains_face: false, detected_ips: [] })
    await new CopySightClient('key').verify(new Uint8Array([1]), 'a.jpg', { advanced: true })

    const [, init] = fetchMock.mock.calls[0]
    const form = init.body as FormData
    expect(form.get('advanced')).toBe('true')
  })

  it('omits the advanced field entirely when not requested', async () => {
    const fetchMock = mockFetch(200, { contains_face: false, detected_ips: [] })
    await new CopySightClient('key').verify(new Uint8Array([1]), 'a.jpg')

    const [, init] = fetchMock.mock.calls[0]
    const form = init.body as FormData
    expect(form.get('advanced')).toBeNull()
  })

  it('sends sensitivity as a string when provided, including the falsy-but-valid value 0', async () => {
    const fetchMock = mockFetch(200, { contains_face: false, detected_ips: [] })
    await new CopySightClient('key').verify(new Uint8Array([1]), 'a.jpg', { sensitivity: 0 })

    const [, init] = fetchMock.mock.calls[0]
    const form = init.body as FormData
    // Guards against a `if (options.sensitivity)` style bug that would
    // silently drop a legitimate sensitivity of 0 — the implementation
    // correctly checks `!== undefined`.
    expect(form.get('sensitivity')).toBe('0')
  })
})
