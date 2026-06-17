import { describe, it, expect, beforeEach } from 'vitest'
import { validateConfig, createValidator, FOUNDATION_RULES } from '@veo-core/validation'
import { _resetDefaultModelCacheForTests } from '@veo-core/constants'
import type { VeoConfig } from '@veo-core/types'

beforeEach(() => _resetDefaultModelCacheForTests())

const base = (over: Partial<VeoConfig> = {}): VeoConfig => ({
  prompt: 'x',
  outputPath: '/tmp/x.mp4',
  ...over,
})

describe('auto-corrections table', () => {
  it('row 1: resolution=1080p AND duration=undefined => duration=8', () => {
    const r = validateConfig(base({ resolution: '1080p' }))
    if (!r.valid) throw new Error('expected valid')
    expect(r.autoFixed.durationSeconds).toBe(8)
    expect(r.autoFixMessages.some((m) => /1080p|4K/i.test(m))).toBe(true)
  })
  it('row 2: region=EU AND personGeneration=allow_all => allow_adult', () => {
    const r = createValidator({ baseRules: FOUNDATION_RULES })(base({ personGeneration: 'allow_all' }), { region: 'eu' })
    if (!r.valid) throw new Error('expected valid')
    expect(r.autoFixed.personGeneration).toBe('allow_adult')
  })
  it('row 3: model=veo-2 AND audio=undefined => audio=false', () => {
    const r = validateConfig(base({ model: 'veo-2.0-generate-001', resolution: '720p', durationSeconds: 8 }))
    if (!r.valid) throw new Error('expected valid')
    expect(r.autoFixed.generateAudio).toBe(false)
  })
  it('row 4: model=veo-2 AND audio=true (explicit) => hard error (no auto-fix)', () => {
    const r = validateConfig(base({ model: 'veo-2.0-generate-001', generateAudio: true, resolution: '720p', durationSeconds: 8 }))
    expect(r.valid).toBe(false)
  })
})

describe('autoFixMessages discipline', () => {
  it('does NOT mention silent default application (aspectRatio/resolution defaulting)', () => {
    const r = validateConfig(base())
    if (!r.valid) throw new Error('expected valid')
    expect(r.autoFixMessages.some((m) => /aspectRatio|resolution/i.test(m))).toBe(false)
    expect(r.autoFixed.aspectRatio).toBe('16:9')
    expect(r.autoFixed.resolution).toBe('720p')
  })
})
