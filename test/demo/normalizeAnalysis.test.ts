import { describe, expect, it } from 'vitest'
import { normalizeAnalysis } from '../../demo/normalizeAnalysis.js'
import { hashAnalysis } from '../../src/core/analysis/AnalysisCanonicalizer.js'
import type { CopySightResponse } from '../../demo/CopySightClient.js'

/**
 * Captured from a real API call against "test samples/AS_PR19_CS1.mp4".
 * The response has no aggregate score field, which is why copyScore is
 * derived from max_similarity across detections.
 */
const REAL_VIDEO_RESPONSE: CopySightResponse = {
  media_type: 'video',
  frames_analyzed: 2,
  duration_seconds: 3.04,
  contains_face: true,
  detected_ips: {
    'Millie Bobby Brown': {
      category: 'Celebrities and famous people',
      author: 'N/A',
      owner: 'Millie Bobby Brown',
      max_similarity: 0.95,
      occurrence_count: 1,
      occurrences: [
        {
          timecode: 3.04,
          timecode_label: '0:03',
          similarity: 0.95,
          bounding_box: { x: 0.08, y: 0.15, width: 0.55, height: 0.75 },
        },
      ],
    },
  },
  resolution: { width: 482, height: 500 },
  source_duration_seconds: 5.2,
}

const CLEAN_IMAGE_RESPONSE: CopySightResponse = {
  contains_face: false,
  detected_ips: [],
}

const IMAGE_RESPONSE_WITH_DETECTION: CopySightResponse = {
  contains_face: false,
  detected_ips: [
    {
      name: 'Mickey Mouse',
      category: 'Characters',
      author: 'Walt Disney and Ub Iwerks',
      owner: 'The Walt Disney Company',
      bounding_box: { x: 0.277, y: 0.469, width: 0.021, height: 0.022 },
      similarity: 0.98,
    },
  ],
}

describe('normalizeAnalysis', () => {
  it('derives copyScore from a real captured video response (95% similarity -> 95)', () => {
    expect(normalizeAnalysis(REAL_VIDEO_RESPONSE).copyScore).toBe(95)
  })

  it('derives copyScore 0 for a clean image with no detections', () => {
    expect(normalizeAnalysis(CLEAN_IMAGE_RESPONSE).copyScore).toBe(0)
  })

  it('derives copyScore from the documented image (array-shaped detected_ips) example (98% -> 98)', () => {
    expect(normalizeAnalysis(IMAGE_RESPONSE_WITH_DETECTION).copyScore).toBe(98)
  })

  it('takes the max similarity across multiple detections, not an average', () => {
    const response: CopySightResponse = {
      contains_face: false,
      detected_ips: [
        {
          name: 'A',
          category: 'Trademarks',
          author: 'N/A',
          owner: 'N/A',
          bounding_box: { x: 0, y: 0, width: 0, height: 0 },
          similarity: 0.3,
        },
        {
          name: 'B',
          category: 'Trademarks',
          author: 'N/A',
          owner: 'N/A',
          bounding_box: { x: 0, y: 0, width: 0, height: 0 },
          similarity: 0.7,
        },
      ],
    }
    expect(normalizeAnalysis(response).copyScore).toBe(70)
  })

  it('rounds to the nearest integer (0-100, matching the uint8 on-chain field)', () => {
    const response: CopySightResponse = {
      contains_face: false,
      detected_ips: [
        {
          name: 'A',
          category: 'Art and artists',
          author: 'N/A',
          owner: 'N/A',
          bounding_box: { x: 0, y: 0, width: 0, height: 0 },
          similarity: 0.876,
        },
      ],
    }
    expect(normalizeAnalysis(response).copyScore).toBe(88)
  })

  it('returns an analysis object that can actually be hashed without throwing', () => {
    const { analysis } = normalizeAnalysis(REAL_VIDEO_RESPONSE)
    expect(() => hashAnalysis(analysis)).not.toThrow()
  })

  it('produces a deterministic hash for the same real response', () => {
    const a = normalizeAnalysis(REAL_VIDEO_RESPONSE)
    const b = normalizeAnalysis(REAL_VIDEO_RESPONSE)
    expect(hashAnalysis(a.analysis)).toBe(hashAnalysis(b.analysis))
  })

  it('produces different hashes for the clean response vs. the detection response', () => {
    const clean = normalizeAnalysis(CLEAN_IMAGE_RESPONSE)
    const detected = normalizeAnalysis(IMAGE_RESPONSE_WITH_DETECTION)
    expect(hashAnalysis(clean.analysis)).not.toBe(hashAnalysis(detected.analysis))
  })
})
