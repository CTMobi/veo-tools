import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { loadStoryboard, runDryRun, parseArgs } from '../multi-cli-utils'

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
})

describe('loadStoryboard', () => {
  it('throws when the JSON has no shots array', () => {
    const p = path.join(tmpDir, 'bad.json')
    fs.writeFileSync(p, JSON.stringify({ name: 'no shots here' }))
    expect(() => loadStoryboard(p)).toThrow(/shots/)
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

  it('exits 2 before touching shot 2 when shot 1 fails validation', () => {
    const errs: string[] = []
    const err = vi.spyOn(console, 'error').mockImplementation((s: unknown) => { errs.push(String(s)) })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    const sb = {
      shots: [
        { prompt: 'a' } as never, // missing outputPath/storageUri → rule #9 fails
        { prompt: 'b', outputPath: '/tmp/b.mp4' },
      ],
    }
    expect(() => runDryRun(sb)).toThrow(/exit:2/)
    expect(errs.some((s) => /shot 0/.test(s))).toBe(true)
    log.mockRestore(); err.mockRestore(); exit.mockRestore()
  })
})
