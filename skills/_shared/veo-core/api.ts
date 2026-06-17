// api.ts — Vertex AI Veo HTTP surface + hardened downloadFile.
import * as http from 'node:http'
import * as https from 'node:https'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { URL } from 'node:url'
import { Storage } from '@google-cloud/storage'
import { encodeImage } from '@veo-core/image-helpers'
import type { VeoConfig } from '@veo-core/types'

const MAX_REDIRECTS = 10
export const SOCKET_IDLE_MS = 30_000
export const TOTAL_DEADLINE_MS = 15 * 60 * 1000
const ERROR_BODY_CAP = 1024
export const REQUEST_TIMEOUT_MS = 30_000 // for makeRequest only (predict/poll)

// apiHost defaults to the real Vertex host (scheme included). Tests override it
// with `http://127.0.0.1:<port>` to stand a local server in for the API.
function defaultApiHost(location: string): string {
  return `https://${location}-aiplatform.googleapis.com`
}

function getEndpoint(apiHost: string, projectId: string, location: string, model: string): string {
  return (
    `${apiHost}/v1/projects/${projectId}` +
    `/locations/${location}/publishers/google/models/${model}:predictLongRunning`
  )
}

function getOperationEndpoint(apiHost: string, projectId: string, location: string, model: string): string {
  // Operation names come back fully qualified from Vertex; for cleanliness we
  // build the fetchPredictOperation URL from the model parent.
  return (
    `${apiHost}/v1/projects/${projectId}` +
    `/locations/${location}/publishers/google/models/${model}:fetchPredictOperation`
  )
}

export function buildRequestBody(c: VeoConfig): unknown {
  const instances: Record<string, unknown> = { prompt: c.prompt }
  if (c.image)      instances.image     = encodeImage(c.image)
  if (c.lastFrame)  instances.lastFrame = encodeImage(c.lastFrame)
  if (c.referenceImages && c.referenceImages.length) {
    instances.referenceImages = c.referenceImages.map((i) => ({
      referenceType: 'asset',
      image: encodeImage(i),
    }))
  }

  const parameters: Record<string, unknown> = {}
  if (c.aspectRatio       !== undefined) parameters.aspectRatio       = c.aspectRatio
  if (c.durationSeconds   !== undefined) parameters.durationSeconds   = c.durationSeconds
  if (c.resolution        !== undefined) parameters.resolution        = c.resolution
  if (c.generateAudio     !== undefined) parameters.generateAudio     = c.generateAudio
  if (c.sampleCount       !== undefined) parameters.sampleCount       = c.sampleCount
  if (c.seed              !== undefined) parameters.seed              = c.seed
  if (c.negativePrompt    !== undefined) parameters.negativePrompt    = c.negativePrompt
  if (c.enhancePrompt     !== undefined) parameters.enhancePrompt     = c.enhancePrompt
  if (c.storageUri        !== undefined) parameters.storageUri        = c.storageUri
  if (c.personGeneration  !== undefined) parameters.personGeneration  = c.personGeneration
  if (c.addWatermark      !== undefined) parameters.addWatermark      = c.addWatermark
  if (c.includeRaiReason  !== undefined) parameters.includeRaiReason  = c.includeRaiReason

  return { instances: [instances], parameters }
}

// parseJsonResponse — JSON.parse a 2xx body, re-throwing a raw SyntaxError as an
// error that names the source (which call) and includes the capped raw body, so a
// 200 with a non-JSON payload (HTML error page, truncated stream) is diagnosable
// instead of surfacing an opaque "Unexpected token" with no HTTP context.
function parseJsonResponse(source: string, body: string): unknown {
  try {
    return JSON.parse(body)
  } catch (e) {
    throw new Error(
      `${source}: could not parse response body as JSON (${(e as Error).message}) — ${body.slice(0, ERROR_BODY_CAP)}`
    )
  }
}

function makeRequest(url: string, method: string, token: string, body?: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib = u.protocol === 'http:' ? http : https
    const req = lib.request(
      {
        method,
        host: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname + u.search,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c as Buffer))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
        res.on('error', reject)
      }
    )
    req.on('timeout', () => req.destroy(new Error(`makeRequest timed out after ${REQUEST_TIMEOUT_MS}ms`)))
    req.on('error', reject)
    if (body !== undefined) req.write(JSON.stringify(body))
    req.end()
  })
}

export async function submitGeneration(
  config: VeoConfig,
  token: string,
  opts: { projectId: string; location: string; apiHost?: string }
): Promise<string> {
  const model = config.model
  if (!model) throw new Error('submitGeneration requires config.model to be resolved')
  const apiHost = opts.apiHost ?? defaultApiHost(opts.location)
  const url = getEndpoint(apiHost, opts.projectId, opts.location, model)
  const { status, body } = await makeRequest(url, 'POST', token, buildRequestBody(config))
  if (status < 200 || status >= 300) {
    throw new Error(`submitGeneration: HTTP ${status} — ${body.slice(0, ERROR_BODY_CAP)}`)
  }
  const parsed = parseJsonResponse('submitGeneration', body) as { name?: string }
  if (!parsed.name) throw new Error(`submitGeneration: missing operation name in response: ${body.slice(0, 256)}`)
  return parsed.name
}

export async function pollOperation(
  operationName: string,
  token: string,
  opts: { projectId: string; location: string; model: string; apiHost?: string }
): Promise<{
  done: boolean
  videoUrl?: string
  gcsUri?: string
  videoBytes?: string
  mimeType?: string
  raiFilteredCount?: number
  raw: unknown
}> {
  const apiHost = opts.apiHost ?? defaultApiHost(opts.location)
  const url = getOperationEndpoint(apiHost, opts.projectId, opts.location, opts.model)
  const { status, body } = await makeRequest(url, 'POST', token, { operationName })
  if (status < 200 || status >= 300) {
    throw new Error(`pollOperation: HTTP ${status} — ${body.slice(0, ERROR_BODY_CAP)}`)
  }
  // Real Vertex predictLongRunning shape (verified live 2026-06-17): the DEFAULT
  // delivery (no storageUri) returns the video inline as videos[0].bytesBase64Encoded
  // + mimeType — there is NO uri/gcsUri in that case. raiMediaFilteredCount reports
  // how many candidates the Responsible-AI filter suppressed.
  const parsed = parseJsonResponse('pollOperation', body) as {
    done?: boolean
    response?: {
      videos?: Array<{ gcsUri?: string; bytesBase64Encoded?: string; uri?: string; mimeType?: string }>
      raiMediaFilteredCount?: number
    }
    error?: { message?: string }
  }
  if (parsed.error?.message) throw new Error(`pollOperation: ${parsed.error.message}`)
  if (!parsed.done) return { done: false, raw: parsed }
  const v = parsed.response?.videos?.[0]
  return {
    done: true,
    videoUrl: v?.uri,
    gcsUri: v?.gcsUri,
    videoBytes: v?.bytesBase64Encoded,
    mimeType: v?.mimeType,
    raiFilteredCount: parsed.response?.raiMediaFilteredCount,
    raw: parsed,
  }
}

// saveInlineVideo — write a base64-encoded video (the default predictLongRunning
// delivery) to outputPath. Uses the same atomic temp+rename discipline as
// downloadFile so a crash leaves a stranded .tmp, never a truncated final file.
export async function saveInlineVideo(base64: string, outputPath: string): Promise<void> {
  const buf = Buffer.from(base64, 'base64')
  const tmp = `${outputPath}.${crypto.randomBytes(8).toString('hex')}.tmp`
  try {
    // Match downloadFromGcs/downloadFromHttps: ensure the parent dir exists before
    // writing. Inline base64 is the DEFAULT delivery, so this is the common path.
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.promises.writeFile(tmp, buf)
    await fs.promises.rename(tmp, outputPath)
  } catch (e) {
    await fs.promises.unlink(tmp).catch(() => {})
    throw e
  }
}

// downloadFile — HTTPS + gs:// dual scheme. Atomic write to randomly-suffixed .tmp then rename.
// opts.socketIdleMs overrides the idle watchdog (tests shorten it; production omits).
export async function downloadFile(
  target: string,
  outputPath: string,
  token: string,
  opts: { socketIdleMs?: number } = {}
): Promise<void> {
  if (target.startsWith('gs://')) {
    return downloadFromGcs(target, outputPath)
  }
  if (target.startsWith('http://') || target.startsWith('https://')) {
    return downloadFromHttps(target, outputPath, token, opts.socketIdleMs ?? SOCKET_IDLE_MS)
  }
  throw new Error(`downloadFile: unsupported scheme — must be http://, https://, or gs:// — got: ${target}`)
}

// decideRedirect — pure redirect policy: reject HTTPS->HTTP downgrades outright and
// report whether the hop crosses origins (so the caller strips Authorization per RFC 6454).
// Exported so the policy is unit-testable without TLS / sockets.
export function decideRedirect(
  currentUrl: URL,
  location: string
): { nextUrl: URL; crossOrigin: boolean } {
  const nextUrl = new URL(location, currentUrl)
  if (currentUrl.protocol === 'https:' && nextUrl.protocol === 'http:') {
    throw new Error(`downloadFile: refusing HTTPS -> HTTP redirect (${currentUrl.href} -> ${nextUrl.href})`)
  }
  return { nextUrl, crossOrigin: originOf(nextUrl) !== originOf(currentUrl) }
}

function tmpSuffixedPath(outputPath: string): string {
  const random = crypto.randomBytes(8).toString('hex')
  return `${outputPath}.${random}.tmp`
}

async function downloadFromGcs(gcsUri: string, outputPath: string): Promise<void> {
  const tmp = tmpSuffixedPath(outputPath)
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true })
  const rest = gcsUri.slice(5)
  const slash = rest.indexOf('/')
  if (slash === -1) throw new Error(`Malformed gs:// URI: ${gcsUri}`)
  const bucket = rest.slice(0, slash)
  const object = rest.slice(slash + 1)
  const storage = new Storage()
  try {
    await storage.bucket(bucket).file(object).download({ destination: tmp })
    await fs.promises.rename(tmp, outputPath)
  } catch (e) {
    await fs.promises.unlink(tmp).catch(() => {})
    throw e
  }
}

function originOf(u: URL): string {
  return `${u.protocol}//${u.host}`
}

async function downloadFromHttps(
  initialUrl: string,
  outputPath: string,
  token: string,
  socketIdleMs: number
): Promise<void> {
  const tmp = tmpSuffixedPath(outputPath)
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true })

  const deadline = Date.now() + TOTAL_DEADLINE_MS
  let currentUrl = new URL(initialUrl)
  let authorizationActive = true
  let redirects = 0

  while (true) {
    if (Date.now() > deadline) {
      await fs.promises.unlink(tmp).catch(() => {})
      throw new Error(`downloadFile: total deadline exceeded (${TOTAL_DEADLINE_MS}ms)`)
    }

    const result = await new Promise<
      | { kind: 'done' }
      | { kind: 'redirect'; location: string }
      | { kind: 'error'; message: string }
    >((resolve) => {
      const isHttps = currentUrl.protocol === 'https:'
      const lib = isHttps ? https : http
      const headers: Record<string, string> = {}
      // Defense-in-depth: only attach the bearer over HTTPS. Never send credentials
      // over cleartext http:// — covers a directly-http initial URL (the HTTPS->HTTP
      // redirect-rejection in decideRedirect handles the downgrade-hop case).
      if (authorizationActive && isHttps) headers.authorization = `Bearer ${token}`

      const req = lib.request(
        {
          method: 'GET',
          host: currentUrl.hostname,
          port: currentUrl.port || (isHttps ? 443 : 80),
          path: currentUrl.pathname + currentUrl.search,
          headers,
        },
        (res) => {
          // Headers arrived: disarm the pre-header watchdog. From here the per-chunk
          // idle timer (armIdle, below) governs the body phase.
          req.setTimeout(0)
          const status = res.statusCode ?? 0
          if (status >= 300 && status < 400 && res.headers.location) {
            resolve({ kind: 'redirect', location: res.headers.location })
            res.resume()
            return
          }
          if (status < 200 || status >= 300) {
            const chunks: Buffer[] = []
            let collected = 0
            res.on('data', (c: Buffer) => {
              if (collected < ERROR_BODY_CAP) {
                chunks.push(c.slice(0, ERROR_BODY_CAP - collected))
                collected += c.length
              }
            })
            res.on('end', () =>
              resolve({
                kind: 'error',
                message: `downloadFile: HTTP ${status} ${currentUrl.href} — ${Buffer.concat(chunks).toString('utf8').slice(0, ERROR_BODY_CAP)}`,
              })
            )
            res.on('error', (e) => resolve({ kind: 'error', message: String(e) }))
            return
          }
          const ws = fs.createWriteStream(tmp)
          let idle: NodeJS.Timeout
          const armIdle = () => {
            if (idle) clearTimeout(idle)
            idle = setTimeout(() => req.destroy(new Error(`socket idle > ${socketIdleMs}ms`)), socketIdleMs)
          }
          armIdle()
          res.on('data', () => armIdle())
          res.on('error', (e) => {
            clearTimeout(idle)
            ws.destroy()
            resolve({ kind: 'error', message: String(e) })
          })
          res.pipe(ws)
          ws.on('finish', () => {
            clearTimeout(idle)
            resolve({ kind: 'done' })
          })
          ws.on('error', (e) => {
            clearTimeout(idle)
            resolve({ kind: 'error', message: String(e) })
          })
        }
      )
      // Pre-header watchdog: the per-chunk idle timer above is only armed inside the
      // response callback, so a server that accepts the socket but never sends headers
      // would otherwise hang until the total deadline. A request-level timeout covers
      // that pre-header wait, rejecting within socketIdleMs.
      req.setTimeout(socketIdleMs, () => req.destroy(new Error(`headers timeout > ${socketIdleMs}ms`)))
      req.on('error', (e) => resolve({ kind: 'error', message: String(e) }))
      req.end()
    })

    if (result.kind === 'done') {
      await fs.promises.rename(tmp, outputPath)
      return
    }
    if (result.kind === 'error') {
      await fs.promises.unlink(tmp).catch(() => {})
      throw new Error(result.message)
    }
    // Redirect
    redirects++
    if (redirects > MAX_REDIRECTS) {
      await fs.promises.unlink(tmp).catch(() => {})
      throw new Error(`downloadFile: too many redirects (>${MAX_REDIRECTS})`)
    }
    let decision: { nextUrl: URL; crossOrigin: boolean }
    try {
      // decideRedirect rejects HTTPS->HTTP downgrades and flags cross-origin hops.
      decision = decideRedirect(currentUrl, result.location)
    } catch (e) {
      await fs.promises.unlink(tmp).catch(() => {})
      throw e
    }
    // Cross-origin Authorization stripping (RFC 6454)
    if (decision.crossOrigin) authorizationActive = false
    currentUrl = decision.nextUrl
  }
}
