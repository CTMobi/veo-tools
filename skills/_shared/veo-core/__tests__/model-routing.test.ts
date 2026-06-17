import { describe, it, expect } from 'vitest'
import { MODEL_SUGGESTIONS, resolveDefaultModel, _resetDefaultModelCacheForTests } from '@veo-core/constants'

describe('MODEL_SUGGESTIONS', () => {
  it('all quality entries route to veo-3.1-generate-001 (no deprecated 3.0)', () => {
    for (const v of Object.values(MODEL_SUGGESTIONS)) {
      expect(v.quality).toBe('veo-3.1-generate-001')
    }
  })
  it('hero-background/ambient/loop include a lite entry', () => {
    expect(MODEL_SUGGESTIONS['hero-background']!.lite).toBe('veo-3.1-lite-generate-001')
    expect(MODEL_SUGGESTIONS['ambient']!.lite).toBe('veo-3.1-lite-generate-001')
    expect(MODEL_SUGGESTIONS['loop']!.lite).toBe('veo-3.1-lite-generate-001')
  })
  it('social/marketing/product/storytelling omit lite', () => {
    expect(MODEL_SUGGESTIONS['social']!.lite).toBeUndefined()
    expect(MODEL_SUGGESTIONS['marketing']!.lite).toBeUndefined()
    expect(MODEL_SUGGESTIONS['product']!.lite).toBeUndefined()
    expect(MODEL_SUGGESTIONS['storytelling']!.lite).toBeUndefined()
  })
  it('unknown use case fallback has no lite', () => {
    _resetDefaultModelCacheForTests()
    const fallback = MODEL_SUGGESTIONS['nonexistent'] ?? {
      quality: resolveDefaultModel(),
      fast: 'veo-3.1-fast-generate-001',
    }
    expect(fallback.quality).toBe('veo-3.1-generate-001')
    expect(fallback.fast).toBe('veo-3.1-fast-generate-001')
    expect((fallback as { lite?: string }).lite).toBeUndefined()
  })
})
