import { describe, it, expect } from 'vitest'
import { ALIAS_MARKER } from '@veo-core/types'

describe('@veo-core/* alias resolution', () => {
  it('imports a value via the alias', () => {
    expect(ALIAS_MARKER).toBe('veo-core')
  })
})
