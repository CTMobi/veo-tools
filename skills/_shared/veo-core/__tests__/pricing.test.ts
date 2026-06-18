import { describe, it, expect } from 'vitest'
import { estimateCost } from '@veo-core/pricing'
import { resolveDefaultModel } from '@veo-core/constants'
import type { VeoConfig } from '@veo-core/types'

const base: VeoConfig = {
  prompt: 'x',
  outputPath: '/tmp/x.mp4',
}

describe('estimateCost — sampleCount strict multiplier', () => {
  it('doubles cost when sampleCount=2 (720p/8s/no-audio)', () => {
    const one = estimateCost({ ...base, model: 'veo-3.1-generate-001', resolution: '720p', durationSeconds: 8, generateAudio: false, sampleCount: 1 })
    const two = estimateCost({ ...base, model: 'veo-3.1-generate-001', resolution: '720p', durationSeconds: 8, generateAudio: false, sampleCount: 2 })
    expect(two.usd).toBe(one.usd * 2)
  })

  it('doubles cost when sampleCount=2 (1080p/5s/audio — previously broke the invariant)', () => {
    const one = estimateCost({ ...base, model: 'veo-3.1-generate-001', resolution: '1080p', durationSeconds: 5, generateAudio: true, sampleCount: 1 })
    const two = estimateCost({ ...base, model: 'veo-3.1-generate-001', resolution: '1080p', durationSeconds: 5, generateAudio: true, sampleCount: 2 })
    expect(two.usd).toBe(one.usd * 2)
  })
})

describe('estimateCost — known models return a positive number with breakdown', () => {
  const models = [
    'veo-3.1-generate-001',
    'veo-3.1-fast-generate-001',
    'veo-3.1-lite-generate-001',
    'veo-3.0-generate-001',
    'veo-3.0-fast-generate-001',
    'veo-2.0-generate-001',
  ]
  for (const model of models) {
    it(`${model} returns usd>0 + non-empty breakdown`, () => {
      const isVeo2 = model.startsWith('veo-2')
      const result = estimateCost({
        ...base,
        model,
        resolution: '720p',
        durationSeconds: isVeo2 ? 8 : 8,
        generateAudio: !isVeo2,
        sampleCount: 1,
      })
      expect(result.usd).toBeGreaterThan(0)
      expect(result.breakdown.length).toBeGreaterThan(0)
    })
  }
})

describe('estimateCost — audio increases cost on Veo 3.x', () => {
  it('audio=true >= audio=false at same resolution/duration', () => {
    const off = estimateCost({ ...base, model: 'veo-3.1-generate-001', resolution: '720p', durationSeconds: 8, generateAudio: false, sampleCount: 1 })
    const on  = estimateCost({ ...base, model: 'veo-3.1-generate-001', resolution: '720p', durationSeconds: 8, generateAudio: true,  sampleCount: 1 })
    expect(on.usd).toBeGreaterThanOrEqual(off.usd)
  })
})

describe('estimateCost — audio default mirrors validation (Veo 3.x default = true)', () => {
  it('prices audio for a Veo 3.x config with generateAudio unset (raw, non-validated config)', () => {
    // validation.ts defaults unspecified Veo-3.x audio to true; estimateCost must
    // do the same so a programmatic caller passing a raw config does not undercount.
    const unset    = estimateCost({ ...base, model: 'veo-3.1-generate-001', resolution: '720p', durationSeconds: 8, sampleCount: 1 })
    const explicit = estimateCost({ ...base, model: 'veo-3.1-generate-001', resolution: '720p', durationSeconds: 8, generateAudio: true, sampleCount: 1 })
    expect(unset.usd).toBe(explicit.usd)
    expect(unset.breakdown).toContain('audio')
  })

  it('does NOT price audio for a Veo 2 config with generateAudio unset (Veo 2 has no audio)', () => {
    const unset = estimateCost({ ...base, model: 'veo-2.0-generate-001', resolution: '720p', durationSeconds: 8, sampleCount: 1 })
    const off   = estimateCost({ ...base, model: 'veo-2.0-generate-001', resolution: '720p', durationSeconds: 8, generateAudio: false, sampleCount: 1 })
    expect(unset.usd).toBe(off.usd)
    expect(unset.breakdown).not.toContain('audio')
  })
})

describe('estimateCost — higher resolution >= lower at same duration', () => {
  it('1080p >= 720p', () => {
    const lo = estimateCost({ ...base, model: 'veo-3.1-generate-001', resolution: '720p',  durationSeconds: 8, generateAudio: false, sampleCount: 1 })
    const hi = estimateCost({ ...base, model: 'veo-3.1-generate-001', resolution: '1080p', durationSeconds: 8, generateAudio: false, sampleCount: 1 })
    expect(hi.usd).toBeGreaterThanOrEqual(lo.usd)
  })
})

describe('estimateCost — default model matches resolveDefaultModel (CR4)', () => {
  it('an undefined-model config prices the centrally-resolved default, not a hardcoded id', () => {
    const undefModel = estimateCost({ ...base, resolution: '720p', durationSeconds: 8, generateAudio: false, sampleCount: 1 })
    const explicit   = estimateCost({ ...base, model: resolveDefaultModel(), resolution: '720p', durationSeconds: 8, generateAudio: false, sampleCount: 1 })
    expect(undefModel.usd).toBe(explicit.usd)
    expect(undefModel.breakdown).toContain(resolveDefaultModel())
  })
})

describe('estimateCost — unknown model throws', () => {
  it('throws with guidance message', () => {
    expect(() =>
      estimateCost({ ...base, model: 'veo-9.9-fake', resolution: '720p', durationSeconds: 8, generateAudio: false, sampleCount: 1 })
    ).toThrow(/unknown model/i)
  })
})

describe('estimateCost — unknown resolution throws (fail-fast, consistent with unknown model)', () => {
  it('throws on an unknown resolution instead of silently defaulting to 1x', () => {
    expect(() =>
      estimateCost({ ...base, model: 'veo-3.1-generate-001', resolution: '8k' as never, durationSeconds: 8, generateAudio: false, sampleCount: 1 })
    ).toThrow(/unknown resolution/i)
  })
})

describe('estimateCost — Veo 2 breakdown never lists audio', () => {
  it('does not list audio in the breakdown for a Veo 2 config even if generateAudio=true is passed', () => {
    // Audio is excluded from Veo 2 pricing; the breakdown must reflect that.
    const r = estimateCost({ ...base, model: 'veo-2.0-generate-001', resolution: '720p', durationSeconds: 8, generateAudio: true, sampleCount: 1 })
    expect(r.breakdown).not.toContain('audio')
  })
})

describe('estimateCost — defensive numeric guards (CR-B)', () => {
  it('throws on durationSeconds=0', () => {
    expect(() =>
      estimateCost({ ...base, model: 'veo-3.1-generate-001', resolution: '720p', durationSeconds: 0, generateAudio: false, sampleCount: 1 })
    ).toThrow(/durationSeconds must be a positive integer/i)
  })
  it('throws on a negative durationSeconds', () => {
    expect(() =>
      estimateCost({ ...base, model: 'veo-3.1-generate-001', resolution: '720p', durationSeconds: -8, generateAudio: false, sampleCount: 1 })
    ).toThrow(/durationSeconds must be a positive integer/i)
  })
  it('throws on sampleCount=0', () => {
    expect(() =>
      estimateCost({ ...base, model: 'veo-3.1-generate-001', resolution: '720p', durationSeconds: 8, generateAudio: false, sampleCount: 0 })
    ).toThrow(/sampleCount must be a positive integer/i)
  })
})
