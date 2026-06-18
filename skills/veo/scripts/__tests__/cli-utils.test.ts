import { describe, it, expect, vi } from 'vitest'
import { parseArgs, buildConfig } from '../cli-utils'

describe('parseArgs', () => {
  it('rejects unknown flags with exit code 2', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => parseArgs(['--nope'])).toThrow(/exit:2/)
    exit.mockRestore()
    err.mockRestore()
  })

  it('exits 2 when a value-taking flag is missing its value', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => parseArgs(['--prompt'])).toThrow(/exit:2/)
    exit.mockRestore()
    err.mockRestore()
  })

  it('exits 2 when a value-taking flag is followed by another flag (--prompt --dry-run)', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    const errs: string[] = []
    const err = vi.spyOn(console, 'error').mockImplementation((s: unknown) => { errs.push(String(s)) })
    expect(() => parseArgs(['--prompt', '--dry-run'])).toThrow(/exit:2/)
    expect(errs.some((s) => /--prompt requires a value/i.test(s))).toBe(true)
    exit.mockRestore()
    err.mockRestore()
  })
  it("accepts a '--'-prefixed value that is not a known flag (--negative-prompt --logo)", () => {
    const out = parseArgs(['--negative-prompt', '--logo'])
    expect(out['--negative-prompt']).toBe('--logo')
  })
})

describe('buildConfig', () => {
  it('rejects non-integer --duration (4abc) as NaN so validateConfig fails it, not silent 4 (CR-E)', () => {
    // parseInt would yield 4 from '4abc'; parseIntStrict yields NaN. validateConfig's
    // rule #1 (MODEL_DURATIONS.has(NaN) === false) then rejects it.
    const cfg = buildConfig({ '--prompt': 'x', '--duration': '4abc' })
    expect(Number.isNaN(cfg.durationSeconds)).toBe(true)
  })
  it('rejects non-integer --sample-count and --seed as NaN (CR-E)', () => {
    expect(Number.isNaN(buildConfig({ '--prompt': 'x', '--sample-count': '2x' }).sampleCount)).toBe(true)
    expect(Number.isNaN(buildConfig({ '--prompt': 'x', '--seed': '9z' }).seed)).toBe(true)
  })
  it('parses a clean integer --duration normally (CR-E)', () => {
    expect(buildConfig({ '--prompt': 'x', '--duration': '8' }).durationSeconds).toBe(8)
  })
  it('--no-audio sets generateAudio=false', () => {
    const cfg = buildConfig({ '--prompt': 'x', '--no-audio': true })
    expect(cfg.generateAudio).toBe(false)
  })
  it('--audio sets generateAudio=true', () => {
    const cfg = buildConfig({ '--prompt': 'x', '--audio': true })
    expect(cfg.generateAudio).toBe(true)
  })
  it('--duration "4" parses to integer 4', () => {
    const cfg = buildConfig({ '--prompt': 'x', '--duration': '4' })
    expect(cfg.durationSeconds).toBe(4)
  })
  it('--enhance-prompt sets enhancePrompt=true; --no-enhance-prompt sets enhancePrompt=false (last-write-wins follows declaration order)', () => {
    const on  = buildConfig({ '--prompt': 'x', '--enhance-prompt': true })
    const off = buildConfig({ '--prompt': 'x', '--no-enhance-prompt': true })
    expect(on.enhancePrompt).toBe(true)
    expect(off.enhancePrompt).toBe(false)
  })
})
