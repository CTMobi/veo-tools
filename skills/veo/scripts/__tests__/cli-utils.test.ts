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
})

describe('buildConfig', () => {
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
