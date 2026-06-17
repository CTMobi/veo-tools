import { describe, it, expect } from 'vitest'
import { estimateCost } from '@veo-core/pricing'
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

describe('estimateCost — higher resolution >= lower at same duration', () => {
  it('1080p >= 720p', () => {
    const lo = estimateCost({ ...base, model: 'veo-3.1-generate-001', resolution: '720p',  durationSeconds: 8, generateAudio: false, sampleCount: 1 })
    const hi = estimateCost({ ...base, model: 'veo-3.1-generate-001', resolution: '1080p', durationSeconds: 8, generateAudio: false, sampleCount: 1 })
    expect(hi.usd).toBeGreaterThanOrEqual(lo.usd)
  })
})

describe('estimateCost — unknown model throws', () => {
  it('throws with guidance message', () => {
    expect(() =>
      estimateCost({ ...base, model: 'veo-9.9-fake', resolution: '720p', durationSeconds: 8, generateAudio: false, sampleCount: 1 })
    ).toThrow(/unknown model/i)
  })
})
