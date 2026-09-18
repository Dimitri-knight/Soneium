import type { CopySightImageResponse, CopySightResponse, CopySightVideoResponse } from './CopySightClient.js'
import type { AnalysisResult } from '../src/core/analysis/AnalysisCanonicalizer.js'

export interface NormalizedAnalysis {
  copyScore: number
  analysis: AnalysisResult
}

function isVideo(response: CopySightResponse): response is CopySightVideoResponse {
  return (response as CopySightVideoResponse).media_type === 'video'
}

/**
 * Maps CopySight's API response into what this module needs: a single
 * 0-100 copyScore, plus a canonicalizable analysis object to hash.
 *
 * CopySight's API has no aggregate score field, so this derives one as
 * round(maxSimilarityAcrossAllDetections * 100), 0 when nothing is
 * detected. Using max (vs. average or a weighted combination) is a
 * reasonable default for "does this asset contain any strong IP match,"
 * but worth revisiting before relying on it beyond a demo.
 */
export function normalizeAnalysis(response: CopySightResponse): NormalizedAnalysis {
  const similarities = isVideo(response)
    ? Object.values(response.detected_ips).map((d) => d.max_similarity)
    : (response as CopySightImageResponse).detected_ips.map((d) => d.similarity)

  const maxSimilarity = similarities.length > 0 ? Math.max(...similarities) : 0
  const copyScore = Math.round(maxSimilarity * 100)

  return {
    copyScore,
    analysis: response as unknown as AnalysisResult,
  }
}
