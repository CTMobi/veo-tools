import { describe, it, expect } from 'vitest'
import { AUDIO_DEFAULTS, DURATION_SUGGESTIONS } from '@veo-core/constants'

describe('AUDIO_DEFAULTS', () => {
  const expected: Array<[string, boolean]> = [
    ['hero-background', false],
    ['ambient', false],
    ['loop', false],
    ['social', true],
    ['marketing', true],
    ['product', true],
    ['storytelling', true],
  ]
  for (const [useCase, want] of expected) {
    it(`${useCase} => ${want}`, () => {
      expect(AUDIO_DEFAULTS[useCase]).toBe(want)
    })
  }
  it('unspecified use case falls through to true', () => {
    expect(AUDIO_DEFAULTS['nonexistent'] ?? true).toBe(true)
  })
})

describe('DURATION_SUGGESTIONS', () => {
  const expected: Array<[string, number]> = [
    ['hero-background', 4],
    ['ambient', 4],
    ['loop', 4],
    ['social', 8],
    ['marketing', 8],
    ['product', 8],
    ['storytelling', 8],
  ]
  for (const [useCase, want] of expected) {
    it(`${useCase} => ${want}`, () => {
      expect(DURATION_SUGGESTIONS[useCase]).toBe(want)
    })
  }
})
