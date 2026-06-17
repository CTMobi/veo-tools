// pricing.ts
// Last updated: 2026-06-16
// Source: https://cloud.google.com/vertex-ai/generative-ai/pricing#veo-models
// REVIEW BEFORE EACH RELEASE
//
// Unknown-model behavior: estimateCost THROWS (deliberate deviation from the
// MODEL_DURATIONS/MODEL_SAMPLE_MAX "return undefined" convention). Rationale:
// callers display the result to the user; silent $0.00 would be misleading.

import type { VeoConfig } from '@veo-core/types'

// Per-second base rates (USD/sec) at 720p without audio, sampleCount=1.
// Resolution multipliers applied below.
// These are illustrative seed values pending oracle review on first paid probe (M13).
const BASE_USD_PER_SEC: Record<string, number> = {
  'veo-3.1-generate-001':      0.50,
  'veo-3.1-fast-generate-001': 0.35,
  'veo-3.1-lite-generate-001': 0.20,
  'veo-3.0-generate-001':      0.50,
  'veo-3.0-fast-generate-001': 0.35,
  'veo-2.0-generate-001':      0.40, // no audio supported
}

const RESOLUTION_MULTIPLIER: Record<string, number> = {
  '720p':  1.00,
  '1080p': 1.50,
  '4k':    3.00,
}

const AUDIO_PER_SEC_DELTA = 0.05 // Veo 3.x only; Veo 2 ignores

export function estimateCost(config: VeoConfig): { usd: number; breakdown: string } {
  const model      = config.model      ?? 'veo-3.1-generate-001'
  const resolution = config.resolution ?? '720p'
  const duration   = config.durationSeconds ?? 8
  const audio      = config.generateAudio === true
  const samples    = config.sampleCount ?? 1

  const base = BASE_USD_PER_SEC[model]
  if (base === undefined) {
    throw new Error(
      `estimateCost: unknown model '${model}' — add it to pricing.ts or use one of: ` +
        Object.keys(BASE_USD_PER_SEC).join(', ')
    )
  }
  const resMult = RESOLUTION_MULTIPLIER[resolution] ?? 1
  const audioDelta = audio && !model.startsWith('veo-2') ? AUDIO_PER_SEC_DELTA : 0

  const perVideo = (base + audioDelta) * resMult * duration
  const usd = perVideo * samples

  const breakdown =
    `${model}, ${duration}s, ${resolution}` +
    (audio ? ', audio' : '') +
    (samples > 1 ? `, x${samples}` : '')

  return { usd: Math.round(usd * 100) / 100, breakdown }
}
