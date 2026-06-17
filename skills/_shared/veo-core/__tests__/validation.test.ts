import { describe, it, expect, beforeEach } from 'vitest'
import { validateConfig, createValidator, FOUNDATION_RULES } from '@veo-core/validation'
import { _resetDefaultModelCacheForTests } from '@veo-core/constants'
import type { VeoConfig, ValidationRule } from '@veo-core/types'

beforeEach(() => _resetDefaultModelCacheForTests())

const ok = (over: Partial<VeoConfig> = {}): VeoConfig => ({
  prompt: 'a sunset over the sea',
  outputPath: '/tmp/x.mp4',
  ...over,
})

describe('validateConfig — never throws', () => {
  it('returns a discriminated union even on garbage', () => {
    const r = validateConfig({ prompt: '', outputPath: '/tmp/x.mp4' } as VeoConfig)
    expect(r).toHaveProperty('valid')
  })
})

describe('Rule #9 — outputPath XOR storageUri', () => {
  it('neither set => error', () => {
    const r = validateConfig({ prompt: 'x' } as VeoConfig)
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.join(' ')).toMatch(/output destination required/i)
  })
  it('both set => error', () => {
    const r = validateConfig(ok({ storageUri: 'gs://b/o' }))
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.join(' ')).toMatch(/ambiguous output/i)
  })
  it('outputPath only => valid', () => {
    const r = validateConfig(ok())
    expect(r.valid).toBe(true)
  })
  it('storageUri only => valid', () => {
    const r = validateConfig({ prompt: 'x', storageUri: 'gs://b/o' })
    expect(r.valid).toBe(true)
  })
  it("outputPath:'' (present-but-blank) => error", () => {
    const r = validateConfig({ prompt: 'x', outputPath: '' })
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.join(' ')).toMatch(/outputPath cannot be empty/i)
  })
  it("storageUri:'   ' (whitespace-only) => error", () => {
    const r = validateConfig({ prompt: 'x', storageUri: '   ' })
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.join(' ')).toMatch(/storageUri cannot be empty/i)
  })
})

describe('Rule #1 — durations per model', () => {
  it('Veo 3.x rejects duration=5', () => {
    const r = validateConfig(ok({ durationSeconds: 5 }))
    expect(r.valid).toBe(false)
  })
  it('Veo 3.x accepts 4/6/8', () => {
    for (const d of [4, 6, 8]) expect(validateConfig(ok({ durationSeconds: d })).valid).toBe(true)
  })
  it('Veo 2 rejects 7 (the previous guess)', () => {
    const r = validateConfig(ok({ model: 'veo-2.0-generate-001', durationSeconds: 7, generateAudio: false }))
    expect(r.valid).toBe(false)
  })
  it('unknown model => soft warning, not error', () => {
    const r = validateConfig(ok({ model: 'veo-9.9-fake', durationSeconds: 99 }))
    expect(r.valid).toBe(true)
    if (r.valid) expect(r.warnings.some((w) => /unknown model/i.test(w))).toBe(true)
  })
})

describe('Rule #2 — 1080p/4k require duration=8', () => {
  it('1080p + undefined duration => auto-fix to 8', () => {
    const r = validateConfig(ok({ resolution: '1080p' }))
    expect(r.valid).toBe(true)
    if (r.valid) {
      expect(r.autoFixed.durationSeconds).toBe(8)
      expect(r.autoFixMessages.join(' ')).toMatch(/duration to 8/i)
    }
  })
  it('1080p + explicit 6 => hard error', () => {
    const r = validateConfig(ok({ resolution: '1080p', durationSeconds: 6 }))
    expect(r.valid).toBe(false)
  })
  it('4k + explicit 4 => hard error', () => {
    const r = validateConfig(ok({ resolution: '4k', durationSeconds: 4 }))
    expect(r.valid).toBe(false)
  })
})

describe('Rule #3 / #4 — Veo 2 constraints', () => {
  it('Veo 2 + undefined audio => auto-fix to false', () => {
    const r = validateConfig(ok({ model: 'veo-2.0-generate-001', resolution: '720p', durationSeconds: 8 }))
    expect(r.valid).toBe(true)
    if (r.valid) {
      expect(r.autoFixed.generateAudio).toBe(false)
      expect(r.autoFixMessages.join(' ')).toMatch(/Veo 2 doesn't support audio/i)
    }
  })
  it('Veo 2 + explicit audio=true => hard error', () => {
    const r = validateConfig(ok({ model: 'veo-2.0-generate-001', generateAudio: true, durationSeconds: 8, resolution: '720p' }))
    expect(r.valid).toBe(false)
  })
  it('Veo 2 + 1080p => hard error', () => {
    const r = validateConfig(ok({ model: 'veo-2.0-generate-001', resolution: '1080p', durationSeconds: 8, generateAudio: false }))
    expect(r.valid).toBe(false)
  })
})

describe('Rule #5 — token soft warning, never rejects', () => {
  it('long prompt => warning, still valid', () => {
    const long = 'x '.repeat(2000)
    const r = validateConfig(ok({ prompt: long }))
    expect(r.valid).toBe(true)
    if (r.valid) expect(r.warnings.some((w) => /token/i.test(w))).toBe(true)
  })
})

describe('Rule #6 — personGeneration regional', () => {
  it('EU + allow_all => auto-fix to allow_adult', () => {
    const r = createValidator({ baseRules: FOUNDATION_RULES })(ok({ personGeneration: 'allow_all' }), { region: 'eu' })
    expect(r.valid).toBe(true)
    if (r.valid) {
      expect(r.autoFixed.personGeneration).toBe('allow_adult')
      expect(r.autoFixMessages.join(' ')).toMatch(/region/i)
    }
  })
  it('restricted-region list is sourced from the shared constant (not hardcoded in the rule)', async () => {
    const { RESTRICTED_PERSON_REGIONS } = await import('@veo-core/constants')
    expect([...RESTRICTED_PERSON_REGIONS]).toEqual(expect.arrayContaining(['eu', 'uk', 'ch', 'mena']))
  })
})

describe('Rule #7 — sampleCount per model', () => {
  it('Veo 2 + sampleCount=4 => error (max=2)', () => {
    const r = validateConfig(ok({ model: 'veo-2.0-generate-001', sampleCount: 4, resolution: '720p', durationSeconds: 8, generateAudio: false }))
    expect(r.valid).toBe(false)
  })
  it('Veo 3.x + sampleCount=4 => valid', () => {
    const r = validateConfig(ok({ sampleCount: 4 }))
    expect(r.valid).toBe(true)
  })
  it('fractional sampleCount=1.5 => error (must be an integer)', () => {
    const r = validateConfig(ok({ sampleCount: 1.5 }))
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.join(' ')).toMatch(/integer/i)
  })
})

describe('Rule #8 — aspect ratio enum', () => {
  it('rejects 21:9', () => {
    const r = validateConfig(ok({ aspectRatio: '21:9' as unknown as '16:9' }))
    expect(r.valid).toBe(false)
  })
  it('accepts 9:16', () => {
    expect(validateConfig(ok({ aspectRatio: '9:16' })).valid).toBe(true)
  })
})

describe('Rule #10 — forward-declared field warning', () => {
  it('videoExtensionInput set => warning, still valid', () => {
    const r = validateConfig(ok({ videoExtensionInput: 'op-name-or-uri' }))
    expect(r.valid).toBe(true)
    if (r.valid) expect(r.warnings.some((w) => /videoExtensionInput/.test(w))).toBe(true)
  })
})

describe('validateConfig — internal ordering invariant', () => {
  it('step 1 resolves default model before any rule sees the config', () => {
    const seen: Array<string | undefined> = []
    const spy: ValidationRule = (cfg) => {
      seen.push(cfg.model)
      return { kind: 'ok' }
    }
    const v = createValidator({ baseRules: [spy] })
    v(ok())
    expect(seen[0]).toBe('veo-3.1-generate-001')
  })
})

describe('createValidator — per-rule try/catch', () => {
  it('a thrown rule is caught and converted to {valid:false}', () => {
    const boom: ValidationRule = () => { throw new Error('synthetic') }
    const r = createValidator({ baseRules: [boom] })(ok())
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.join(' ')).toMatch(/threw|synthetic/i)
  })
})

describe('Rule #11 — Veo 3 cannot disable prompt enhancement (M13 probe finding 2026-06-17)', () => {
  // Vertex rejects enhancePrompt=false on Veo 3 at runtime:
  //   "Veo 3 prompt enhancement cannot be disabled."
  // This rule surfaces that before the paid API call instead of after.
  it('veo-3.x + enhancePrompt=false => error', () => {
    const r = validateConfig(ok({ model: 'veo-3.1-generate-001', enhancePrompt: false }))
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.join(' ')).toMatch(/enhanc/i)
  })
  it('veo-3.x + enhancePrompt=true => valid', () => {
    expect(validateConfig(ok({ model: 'veo-3.1-generate-001', enhancePrompt: true })).valid).toBe(true)
  })
  it('veo-3.x + enhancePrompt undefined => valid (rule guards undefined)', () => {
    expect(validateConfig(ok({ model: 'veo-3.1-generate-001' })).valid).toBe(true)
  })
  it('veo-2 + enhancePrompt=false => valid (constraint is Veo 3 only)', () => {
    const r = validateConfig(ok({ model: 'veo-2.0-generate-001', enhancePrompt: false, generateAudio: false, resolution: '720p', durationSeconds: 5 }))
    expect(r.valid).toBe(true)
  })
})
