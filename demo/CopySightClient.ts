export interface CopySightImageDetection {
  name: string
  category: string
  author: string
  owner: string
  bounding_box: { x: number; y: number; width: number; height: number }
  similarity: number
}

export interface CopySightImageResponse {
  contains_face: boolean
  detected_ips: CopySightImageDetection[]
}

export interface CopySightVideoOccurrence {
  timecode: number
  timecode_label: string
  similarity: number
  bounding_box: { x: number; y: number; width: number; height: number }
}

export interface CopySightVideoDetection {
  category: string
  author: string
  owner: string
  max_similarity: number
  occurrence_count: number
  occurrences: CopySightVideoOccurrence[]
}

export interface CopySightVideoResponse {
  media_type: 'video'
  frames_analyzed: number
  duration_seconds: number
  source_duration_seconds: number
  resolution: { width: number; height: number }
  contains_face: boolean
  detected_ips: Record<string, CopySightVideoDetection>
}

export type CopySightResponse = CopySightImageResponse | CopySightVideoResponse

export class CopySightApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    public readonly retryAfterSeconds?: number
  ) {
    super(`CopySight API error ${status}: ${JSON.stringify(body)}`)
  }
}

export interface VerifyOptions {
  advanced?: boolean
  sensitivity?: number
}

/**
 * Thin wrapper around CopySight's `/verify` endpoint.
 *
 * Not part of the production integration — the real CopySight x Soneium
 * module is called in-process by CopySight's own backend after its
 * analysis runs, and takes an already-computed analysis rather than
 * fetching one (see BlockchainProofService). This client exists only to
 * drive an end-to-end demo against real CopySight output instead of
 * fixtures. The API has no aggregate score field — see
 * normalizeAnalysis.ts for how copyScore is derived.
 */
export class CopySightClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = 'https://api.copysight.ai/v1'
  ) {}

  async verify(fileBytes: Uint8Array, filename: string, options: VerifyOptions = {}): Promise<CopySightResponse> {
    const form = new FormData()
    // Buffer's Uint8Array<ArrayBufferLike> isn't assignable to BlobPart under
    // these DOM lib types (ArrayBufferLike also covers SharedArrayBuffer).
    // Copying into a fresh ArrayBuffer-backed Uint8Array sidesteps that —
    // cheap enough for these small demo files.
    const blobSafeBytes = new Uint8Array(fileBytes)
    form.append('file', new Blob([blobSafeBytes]), filename)
    if (options.advanced) form.append('advanced', 'true')
    if (options.sensitivity !== undefined) form.append('sensitivity', String(options.sensitivity))

    const response = await fetch(`${this.baseUrl}/verify`, {
      method: 'POST',
      headers: { 'X-API-Key': this.apiKey },
      body: form,
    })

    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      const retryAfterHeader = response.headers.get('retry-after')
      const bodyRetryAfter = (body as { retry_after?: number })?.retry_after
      throw new CopySightApiError(
        response.status,
        body,
        retryAfterHeader ? Number(retryAfterHeader) : bodyRetryAfter
      )
    }

    return (await response.json()) as CopySightResponse
  }
}
