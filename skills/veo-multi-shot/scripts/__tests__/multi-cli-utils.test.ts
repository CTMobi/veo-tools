import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { loadStoryboard, runDryRun, validateShots, parseArgs } from '../multi-cli-utils'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veo-multi-test-'))
})
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('parseArgs', () => {
  it('exits 2 when --storyboard is followed by another flag (--storyboard --dry-run)', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    const errs: string[] = []
    const err = vi.spyOn(console, 'error').mockImplementation((s: unknown) => { errs.push(String(s)) })
    expect(() => parseArgs(['--storyboard', '--dry-run'])).toThrow(/exit:2/)
    expect(errs.some((s) => /--storyboard requires a value/i.test(s))).toBe(true)
    exit.mockRestore(); err.mockRestore()
  })

  it('exits 2 on an unknown flag', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => parseArgs(['--nope'])).toThrow(/exit:2/)
    exit.mockRestore(); err.mockRestore()
  })

  it('parses --storyboard PATH --dry-run correctly', () => {
    const a = parseArgs(['--storyboard', '/tmp/sb.json', '--dry-run'])
    expect(a.storyboardPath).toBe('/tmp/sb.json')
    expect(a.dryRun).toBe(true)
  })

  it("accepts a '--'-prefixed value that is not a known flag (--storyboard --logo)", () => {
    const a = parseArgs(['--storyboard', '--logo'])
    expect(a.storyboardPath).toBe('--logo')
  })
})

describe('loadStoryboard', () => {
  it('throws when the JSON has no shots array', () => {
    const p = path.join(tmpDir, 'bad.json')
    fs.writeFileSync(p, JSON.stringify({ name: 'no shots here' }))
    expect(() => loadStoryboard(p)).toThrow(/shots/)
  })

  it('throws a clear contextual error (not a raw SyntaxError) on malformed JSON (CLAUDE-2)', () => {
    const p = path.join(tmpDir, 'malformed.json')
    fs.writeFileSync(p, '{ "shots": [ }') // invalid JSON
    expect(() => loadStoryboard(p)).toThrow(/invalid storyboard JSON at .*malformed\.json:/)
  })
})

describe('validateShots', () => {
  it('returns resolved configs for valid shots without printing cost lines (CLAUDE-NEW)', () => {
    const logs: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((s: unknown) => { logs.push(String(s)) })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    const sb = { shots: [{ prompt: 'a', outputPath: '/tmp/a.mp4' }] }
    const resolved = validateShots(sb)
    expect(resolved.length).toBe(1)
    expect(resolved[0]?.model).toBeTruthy()
    // No cost/total lines on a live validation pass.
    expect(logs.some((l) => /estimated cost|^shot /.test(l))).toBe(false)
    log.mockRestore(); err.mockRestore(); exit.mockRestore()
  })

  it("emits validator autoFixMessages to stderr for a Veo2 shot with unspecified audio (CLAUDE-AFM)", () => {
    const logs: string[] = []
    const errs: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((s: unknown) => { logs.push(String(s)) })
    const err = vi.spyOn(console, 'error').mockImplementation((s: unknown) => { errs.push(String(s)) })
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    const sb = { shots: [{ prompt: 'a', outputPath: '/tmp/a.mp4', model: 'veo-2.0-generate-001' }] }
    validateShots(sb)
    expect(errs.some((s) => /shot 0/.test(s) && /Veo 2 doesn't support audio/i.test(s))).toBe(true)
    // Auto-fix messages must NOT pollute stdout (reserved for JSON results).
    expect(logs.some((l) => /Veo 2 doesn't support audio/i.test(l))).toBe(false)
    log.mockRestore(); err.mockRestore(); exit.mockRestore()
  })

  it('exits 2 on the first invalid shot (CLAUDE-NEW)', () => {
    const errs: string[] = []
    const err = vi.spyOn(console, 'error').mockImplementation((s: unknown) => { errs.push(String(s)) })
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    const sb = { shots: [{ prompt: 'a' } as never] } // missing output dest -> rule #9
    expect(() => validateShots(sb)).toThrow(/exit:2/)
    expect(errs.some((s) => /shot 0/.test(s))).toBe(true)
    err.mockRestore(); exit.mockRestore()
  })
})

describe('runDryRun', () => {
  it('emits one cost line per valid shot and a total', () => {
    const logs: string[] = []
    const errs: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((s: unknown) => { logs.push(String(s)) })
    const err = vi.spyOn(console, 'error').mockImplementation((s: unknown) => { errs.push(String(s)) })
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    const sb = {
      shots: [
        { prompt: 'a', outputPath: '/tmp/a.mp4' },
        { prompt: 'b', outputPath: '/tmp/b.mp4' },
      ],
    }
    runDryRun(sb)
    expect(logs.filter((l) => l.startsWith('shot ')).length).toBe(2)
    expect(logs.some((l) => l.startsWith('total estimated cost:'))).toBe(true)
    log.mockRestore(); err.mockRestore(); exit.mockRestore()
  })

  it("surfaces validator auto-adjustments before the cost line for a Veo2 shot with unspecified audio (CLAUDE-AFM)", () => {
    const logs: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((s: unknown) => { logs.push(String(s)) })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    const sb = { shots: [{ prompt: 'a', outputPath: '/tmp/a.mp4', model: 'veo-2.0-generate-001' }] }
    runDryRun(sb)
    const adjIdx = logs.findIndex((l) => /shot 0 adjustments:/.test(l) && /Veo 2 doesn't support audio/i.test(l))
    const costIdx = logs.findIndex((l) => /^shot 0:/.test(l))
    expect(adjIdx).toBeGreaterThanOrEqual(0)
    expect(costIdx).toBeGreaterThanOrEqual(0)
    expect(adjIdx).toBeLessThan(costIdx)
    log.mockRestore(); err.mockRestore(); exit.mockRestore()
  })

  it('exits 2 with a clear per-shot error (not an uncaught throw) on an unknown model (COP3)', () => {
    const errs: string[] = []
    const err = vi.spyOn(console, 'error').mockImplementation((s: unknown) => { errs.push(String(s)) })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    // An unknown model passes validation (only a warning) but estimateCost throws.
    const sb = {
      shots: [{ prompt: 'a', outputPath: '/tmp/a.mp4', model: 'veo-9-imaginary-001' }],
    }
    expect(() => runDryRun(sb)).toThrow(/exit:2/)
    expect(errs.some((s) => /shot 0/.test(s) && /unknown model/i.test(s))).toBe(true)
    log.mockRestore(); err.mockRestore(); exit.mockRestore()
  })

  it('processes a valid shot 0 then stops at the first invalid shot (shot 1)', () => {
    const errs: string[] = []
    const err = vi.spyOn(console, 'error').mockImplementation((s: unknown) => { errs.push(String(s)) })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    const sb = {
      shots: [
        { prompt: 'a', outputPath: '/tmp/a.mp4' },   // valid → processed
        { prompt: 'b' } as never,                     // missing output dest → rule #9 fails
      ],
    }
    expect(() => runDryRun(sb)).toThrow(/exit:2/)
    // The error must reference shot 1 (index 1) — proving validation proceeded past
    // shot 0 and stopped at the first invalid shot, not shot 0.
    expect(errs.some((s) => /shot 1/.test(s))).toBe(true)
    expect(errs.some((s) => /shot 0/.test(s))).toBe(false)
    log.mockRestore(); err.mockRestore(); exit.mockRestore()
  })
})
