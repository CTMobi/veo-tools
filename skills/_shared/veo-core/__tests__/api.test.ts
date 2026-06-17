import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as http from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { downloadFile } from '@veo-core/api'

// We exercise the redirect / error-body-cap / atomic-write logic against a local
// http server. HTTPS-specific paths (cross-origin Authorization stripping,
// HTTPS->HTTP rejection) and the socket-idle timeout are covered in the dedicated
// api-redirect-security.test.ts (Task 4.1b); submitGeneration/pollOperation/
// buildRequestBody are covered in api-request.test.ts (Task 4.1c).

let server: http.Server
let port: number
let tmpDir: string

const PAYLOAD = Buffer.alloc(64, 0x41) // 64 bytes of 'A'
const BIG_BODY = Buffer.alloc(64 * 1024, 0x42) // 64 KB

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veo-api-test-'))
  server = http.createServer((req, res) => {
    const url = req.url ?? '/'
    if (url === '/ok') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      res.end(PAYLOAD)
      return
    }
    if (url.startsWith('/redirect-chain/')) {
      const n = parseInt(url.split('/').pop()!, 10)
      if (n <= 0) { res.writeHead(302, { location: '/ok' }); res.end(); return }
      res.writeHead(302, { location: `/redirect-chain/${n - 1}` })
      res.end()
      return
    }
    if (url === '/redirect-loop') {
      res.writeHead(302, { location: '/redirect-loop' })
      res.end()
      return
    }
    if (url === '/err-big') {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end(BIG_BODY)
      return
    }
    res.writeHead(404)
    res.end('not found')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  port = (server.address() as { port: number }).port
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('downloadFile — https branch (using http here for test infra; same code path)', () => {
  it('writes the file atomically (no .tmp left behind on success)', async () => {
    const out = path.join(tmpDir, 'a.bin')
    await downloadFile(`http://127.0.0.1:${port}/ok`, out, 'fake-token')
    expect(fs.readFileSync(out).equals(PAYLOAD)).toBe(true)
    const stranded = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.tmp'))
    expect(stranded.length).toBe(0)
  })

  it('follows redirects up to depth 10', async () => {
    const out = path.join(tmpDir, 'b.bin')
    await downloadFile(`http://127.0.0.1:${port}/redirect-chain/5`, out, 'fake-token')
    expect(fs.readFileSync(out).equals(PAYLOAD)).toBe(true)
  })

  it('rejects when redirect chain exceeds depth 10', async () => {
    const out = path.join(tmpDir, 'c.bin')
    await expect(
      downloadFile(`http://127.0.0.1:${port}/redirect-chain/15`, out, 'fake-token')
    ).rejects.toThrow(/redirect/i)
  })

  it('caps error body at ~1 KB in the thrown message', async () => {
    const out = path.join(tmpDir, 'd.bin')
    let err: Error | undefined
    try {
      await downloadFile(`http://127.0.0.1:${port}/err-big`, out, 'fake-token')
    } catch (e) {
      err = e as Error
    }
    expect(err).toBeDefined()
    expect(err!.message.length).toBeLessThan(2048) // 1KB body + status/url framing
  })

  it('leaves no stranded .tmp on error', async () => {
    const out = path.join(tmpDir, 'e.bin')
    try {
      await downloadFile(`http://127.0.0.1:${port}/err-big`, out, 'fake-token')
    } catch { /* expected */ }
    expect(fs.existsSync(out)).toBe(false)
    const stranded = fs.readdirSync(tmpDir).filter((f) => f.startsWith('e.bin') && f.endsWith('.tmp'))
    expect(stranded.length).toBe(0)
  })
})

describe('downloadFile — URL scheme handling', () => {
  it('rejects unsupported schemes', async () => {
    await expect(
      downloadFile('ftp://example.com/file', path.join(tmpDir, 'f.bin'), 'fake-token')
    ).rejects.toThrow(/scheme|protocol|http|gs:/i)
  })
})
