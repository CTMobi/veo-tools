// pricing.ts
// Last updated: 2026-06-16
// Source: https://cloud.google.com/vertex-ai/generative-ai/pricing#veo-models
// REVIEW BEFORE EACH RELEASE
//
// Unknown-model behavior: estimateCost THROWS (deliberate deviation from the
// MODEL_DURATIONS/MODEL_SAMPLE_MAX "return undefined" convention). Rationale:
// callers display the result to the user; silent $0.00 would be misleading.

import type { VeoConfig } from '@veo-core/types'
import { resolveDefaultModel } from '@veo-core/constants'

// Per-second base rates (USD/sec) at 720p without audio, sampleCount=1.
// Resolution multipliers applied below.
// NOTE: the M13 paid probe (2026-06-17) verified model liveness and the response
// shape, NOT the exact per-second prices. These remain ESTIMATES — confirm against
// the official Vertex AI Veo pricing page before relying on the figures for billing.
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
  // Use the centralized default so the cost estimate matches the model actually
  // selected at runtime (validation.ts resolves the same way), rather than a
  // hardcoded literal that can drift from DEFAULT_MODEL_CHAIN.
  const model      = config.model      ?? resolveDefaultModel()
  const resolution = config.resolution ?? '720p'
  const duration   = config.durationSeconds ?? 8
  const samples    = config.sampleCount ?? 1
  // Mirror validation.ts's audio default so a raw (non-validated) config does not
  // undercount: unspecified audio is true on Veo 3.x (native default), false on Veo 2.
  const audio      = config.generateAudio ?? !model.startsWith('veo-2')

  const base = BASE_USD_PER_SEC[model]
  if (base === undefined) {
    throw new Error(
      `estimateCost: unknown model '${model}' — add it to pricing.ts or use one of: ` +
        Object.keys(BASE_USD_PER_SEC).join(', ')
    )
  }
  const resMult = RESOLUTION_MULTIPLIER[resolution]
  if (resMult === undefined) {
    throw new Error(
      `estimateCost: unknown resolution '${resolution}' — add it to pricing.ts or use one of: ` +
        Object.keys(RESOLUTION_MULTIPLIER).join(', ')
    )
  }
  // Audio is only billed on Veo 3.x; Veo 2 ignores it entirely.
  const audioBilled = audio && !model.startsWith('veo-2')
  const audioDelta = audioBilled ? AUDIO_PER_SEC_DELTA : 0

  // Round per-video cost first, then multiply by sampleCount so that
  // estimateCost({ sampleCount: N }).usd === N * estimateCost({ sampleCount: 1 }).usd
  // for every valid input combination.
  const perVideoRounded = Math.round((base + audioDelta) * resMult * duration * 100) / 100
  const usd = perVideoRounded * samples

  const breakdown =
    `${model}, ${duration}s, ${resolution}` +
    (audioBilled ? ', audio' : '') +
    (samples > 1 ? `, x${samples}` : '')

  return { usd, breakdown }
}
