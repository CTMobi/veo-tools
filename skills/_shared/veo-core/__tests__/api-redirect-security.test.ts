import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as http from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { downloadFile } from '@veo-core/api'

const PAYLOAD = Buffer.alloc(32, 0x41)

let tmpDir: string

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veo-api-sec-'))
})
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('downloadFile — cross-origin Authorization stripping (RFC 6454)', () => {
  it('strips Authorization when a redirect crosses to a different origin (host/port)', async () => {
    // Server B (the redirect TARGET) records whatever Authorization header it receives.
    let authSeenOnB: string | undefined = 'UNSET'
    const serverB = http.createServer((req, res) => {
      authSeenOnB = req.headers.authorization
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      res.end(PAYLOAD)
    })
    await new Promise<void>((r) => serverB.listen(0, '127.0.0.1', () => r()))
    const portB = (serverB.address() as { port: number }).port

    // Server A 302-redirects to B (different port => different origin per RFC 6454).
    const serverA = http.createServer((req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${portB}/video.mp4` })
      res.end()
    })
    await new Promise<void>((r) => serverA.listen(0, '127.0.0.1', () => r()))
    const portA = (serverA.address() as { port: number }).port

    try {
      const out = path.join(tmpDir, 'cross.bin')
      await downloadFile(`http://127.0.0.1:${portA}/start`, out, 'secret-bearer-token')
      expect(fs.readFileSync(out).equals(PAYLOAD)).toBe(true)
      // The bearer token must NOT have been forwarded to the different origin.
      expect(authSeenOnB).toBeUndefined()
    } finally {
      await new Promise<void>((r) => serverA.close(() => r()))
      await new Promise<void>((r) => serverB.close(() => r()))
    }
  })

  it('keeps Authorization on a same-origin redirect (sanity: stripping is origin-scoped, not blanket)', async () => {
    let authSeen: string | undefined = 'UNSET'
    const server = http.createServer((req, res) => {
      if (req.url === '/start') {
        // Redirect to a different PATH on the SAME origin.
        res.writeHead(302, { location: '/video.mp4' })
        res.end()
        return
      }
      authSeen = req.headers.authorization
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      res.end(PAYLOAD)
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as { port: number }).port
    try {
      const out = path.join(tmpDir, 'same.bin')
      await downloadFile(`http://127.0.0.1:${port}/start`, out, 'secret-bearer-token')
      expect(authSeen).toBe('Bearer secret-bearer-token')
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
    }
  })
})

describe('downloadFile — HTTPS→HTTP redirect is rejected outright', () => {
  // A real TLS server would force the test to either disable TLS verification
  // (NODE_TLS_REJECT_UNAUTHORIZED=0 — forbidden: enables MITM) or inject a trusted
  // CA, neither of which is hermetic in CI. The behavior under test is purely the
  // redirect-decision branch, so Task 4.2 exposes it as a pure, side-effect-free
  // export `decideRedirect(currentUrl, location)` that downloadFromHttps calls. We
  // unit-test that branch directly — no sockets, no cert handling, no TLS bypass.
  it('rejects an https:// -> http:// downgrade', async () => {
    const { decideRedirect } = await import('@veo-core/api')
    expect(() =>
      decideRedirect(new URL('https://host-a.example/v.mp4'), 'http://host-b.example/v.mp4')
    ).toThrow(/HTTPS.*HTTP|cleartext/i)
  })
  it('allows https:// -> https:// and reports cross-origin so Authorization is stripped', async () => {
    const { decideRedirect } = await import('@veo-core/api')
    const d = decideRedirect(new URL('https://host-a.example/v.mp4'), 'https://host-b.example/v.mp4')
    expect(d.nextUrl.host).toBe('host-b.example')
    expect(d.crossOrigin).toBe(true)
  })
  it('allows https:// -> https:// same origin and reports same-origin', async () => {
    const { decideRedirect } = await import('@veo-core/api')
    const d = decideRedirect(new URL('https://host-a.example/v.mp4'), 'https://host-a.example/other.mp4')
    expect(d.crossOrigin).toBe(false)
  })
})

describe('downloadFile — socket-idle timeout (belt) and total deadline (suspenders)', () => {
  it('rejects when the socket stalls mid-body past the idle limit', async () => {
    // Write one byte then stall forever. The idle watchdog must fire.
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': '1024' })
      res.write(Buffer.from([0x41])) // one byte, then never finish
      // intentionally do NOT call res.end()
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as { port: number }).port
    try {
      const out = path.join(tmpDir, 'stall.bin')
      await expect(
        downloadFile(`http://127.0.0.1:${port}/slow`, out, 'tok', { socketIdleMs: 200 })
      ).rejects.toThrow(/idle/i)
      expect(fs.existsSync(out)).toBe(false) // no stranded final file
    } finally {
      server.closeAllConnections?.()
      await new Promise<void>((r) => server.close(() => r()))
    }
  }, 10_000)

  it('rejects when the server accepts the socket but never sends headers (pre-header stall)', async () => {
    // Accept the connection and never write a response. The request-level timeout
    // must fire within socketIdleMs instead of hanging until the total deadline.
    const server = http.createServer(() => {
      // intentionally never call res.writeHead / res.end
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as { port: number }).port
    try {
      const out = path.join(tmpDir, 'noheaders.bin')
      await expect(
        downloadFile(`http://127.0.0.1:${port}/hang`, out, 'tok', { socketIdleMs: 200 })
      ).rejects.toThrow(/headers timeout|idle/i)
      expect(fs.existsSync(out)).toBe(false)
    } finally {
      server.closeAllConnections?.()
      await new Promise<void>((r) => server.close(() => r()))
    }
  }, 10_000)
})

describe('api timeout constants are wired', () => {
  it('exports the three documented timeout constants', async () => {
    const api = await import('@veo-core/api')
    expect(api.REQUEST_TIMEOUT_MS).toBe(30_000)
    expect(api.SOCKET_IDLE_MS).toBe(30_000)
    expect(api.TOTAL_DEADLINE_MS).toBe(15 * 60 * 1000)
  })
})
