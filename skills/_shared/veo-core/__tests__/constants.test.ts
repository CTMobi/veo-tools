import { beforeEach, describe, expect, it } from 'vitest'
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL_CHAIN,
  MODEL_DURATIONS,
  MODEL_SAMPLE_MAX,
  REGIONS,
  MAX_TOKENS,
  TOKEN_WARNING_THRESHOLD,
  resolveDefaultModel,
  detectRegion,
  _resetDefaultModelCacheForTests,
} from '@veo-core/constants'

describe('AVAILABLE_MODELS', () => {
  it('contains exactly the 6 pinned IDs', () => {
    expect([...AVAILABLE_MODELS].sort()).toEqual(
      [
        'veo-2.0-generate-001',
        'veo-3.0-fast-generate-001',
        'veo-3.0-generate-001',
        'veo-3.1-fast-generate-001',
        'veo-3.1-generate-001',
        'veo-3.1-lite-generate-001',
      ].sort()
    )
  })
})

describe('DEFAULT_MODEL_CHAIN', () => {
  it('is veo-3.1-generate-001 then veo-3.1-fast-generate-001', () => {
    expect(DEFAULT_MODEL_CHAIN).toEqual([
      'veo-3.1-generate-001',
      'veo-3.1-fast-generate-001',
    ])
  })
})

describe('MODEL_DURATIONS', () => {
  it('Veo 3.x => {4,6,8}', () => {
    for (const m of [
      'veo-3.1-generate-001',
      'veo-3.1-fast-generate-001',
      'veo-3.1-lite-generate-001',
      'veo-3.0-generate-001',
      'veo-3.0-fast-generate-001',
    ]) {
      expect([...MODEL_DURATIONS.get(m)!].sort()).toEqual([4, 6, 8])
    }
  })
  it('Veo 2 => {5,6,8} (7 is NOT accepted)', () => {
    expect([...MODEL_DURATIONS.get('veo-2.0-generate-001')!].sort()).toEqual([5, 6, 8])
  })
  it('unknown model => undefined', () => {
    expect(MODEL_DURATIONS.get('veo-9.9-nonexistent')).toBeUndefined()
  })
})

describe('MODEL_SAMPLE_MAX', () => {
  it('Veo 3.x GA = 4, Veo 2 = 2, Lite PROVISIONAL = 4', () => {
    expect(MODEL_SAMPLE_MAX['veo-3.1-generate-001']).toBe(4)
    expect(MODEL_SAMPLE_MAX['veo-3.1-fast-generate-001']).toBe(4)
    expect(MODEL_SAMPLE_MAX['veo-3.1-lite-generate-001']).toBe(4)
    expect(MODEL_SAMPLE_MAX['veo-3.0-generate-001']).toBe(4)
    expect(MODEL_SAMPLE_MAX['veo-3.0-fast-generate-001']).toBe(4)
    expect(MODEL_SAMPLE_MAX['veo-2.0-generate-001']).toBe(2)
  })
})

describe('MAX_TOKENS / TOKEN_WARNING_THRESHOLD', () => {
  it('1024 / 900', () => {
    expect(MAX_TOKENS).toBe(1024)
    expect(TOKEN_WARNING_THRESHOLD).toBe(900)
  })
})

describe('resolveDefaultModel', () => {
  beforeEach(() => _resetDefaultModelCacheForTests())
  it('returns veo-3.1-generate-001 on first call', () => {
    expect(resolveDefaultModel()).toBe('veo-3.1-generate-001')
  })
  it('memoizes', () => {
    const a = resolveDefaultModel()
    const b = resolveDefaultModel()
    expect(a).toBe(b)
  })
})

describe('detectRegion', () => {
  it('envRegion wins over gcpLocation', () => {
    expect(detectRegion('europe-west2', 'us')).toBe('us')
  })
  it('exact match europe-west2 => uk (beats europe- prefix)', () => {
    expect(detectRegion('europe-west2')).toBe('uk')
  })
  it('exact match europe-west6 => ch', () => {
    expect(detectRegion('europe-west6')).toBe('ch')
  })
  it('prefix europe- => eu', () => {
    expect(detectRegion('europe-west1')).toBe('eu')
  })
  it('prefix us- => us', () => {
    expect(detectRegion('us-central1')).toBe('us')
  })
  it('prefix northamerica- => us', () => {
    expect(detectRegion('northamerica-northeast1')).toBe('us')
  })
  it('prefix me- => mena', () => {
    expect(detectRegion('me-west1')).toBe('mena')
  })
  it('prefix asia- => other', () => {
    expect(detectRegion('asia-east1')).toBe('other')
  })
  it('prefix australia- => other', () => {
    expect(detectRegion('australia-southeast1')).toBe('other')
  })
  it('prefix southamerica- => other', () => {
    expect(detectRegion('southamerica-east1')).toBe('other')
  })
  it('no gcpLocation and no envRegion => undefined', () => {
    expect(detectRegion()).toBeUndefined()
  })
  it('unknown region => undefined', () => {
    expect(detectRegion('africa-mars1')).toBeUndefined()
  })
})

describe('REGIONS ordering invariant', () => {
  it('exact entries come before prefix entries', () => {
    const firstPrefixIdx = REGIONS.findIndex((e) => e.type === 'prefix')
    const lastExactIdx = (() => {
      let i = -1
      REGIONS.forEach((e, idx) => { if (e.type === 'exact') i = idx })
      return i
    })()
    expect(lastExactIdx).toBeLessThan(firstPrefixIdx)
  })
})
