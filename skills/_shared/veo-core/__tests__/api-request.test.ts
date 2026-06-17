import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import * as http from 'node:http'
import { submitGeneration, pollOperation, buildRequestBody } from '@veo-core/api'
import type { VeoConfig } from '@veo-core/types'

let server: http.Server
let port: number
let lastBody: any
let nextStatus = 200
let nextResponse = ''

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      lastBody = raw ? JSON.parse(raw) : undefined
      res.writeHead(nextStatus, { 'content-type': 'application/json' })
      res.end(nextResponse)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  port = (server.address() as { port: number }).port
})
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
})
beforeEach(() => {
  lastBody = undefined
  nextStatus = 200
  nextResponse = ''
})

// The local http server stands in for the Vertex host; opts.apiHost makes the
// scheme+host overridable for tests (production callers omit it -> https + real host).
const opts = () => ({ projectId: 'p', location: 'us-central1', apiHost: `http://127.0.0.1:${port}` })

const cfg = (over: Partial<VeoConfig> = {}): VeoConfig => ({
  prompt: 'a sunset',
  model: 'veo-3.1-generate-001',
  outputPath: '/tmp/x.mp4',
  ...over,
})

describe('submitGeneration', () => {
  it('returns the operation name on 200', async () => {
    nextResponse = JSON.stringify({ name: 'projects/p/operations/abc' })
    const name = await submitGeneration(cfg(), 'tok', opts())
    expect(name).toBe('projects/p/operations/abc')
  })
  it('throws with body capped at 1KB on a 4xx', async () => {
    nextStatus = 400
    nextResponse = 'E'.repeat(4096)
    let err: Error | undefined
    try { await submitGeneration(cfg(), 'tok', opts()) } catch (e) { err = e as Error }
    expect(err).toBeDefined()
    expect(err!.message).toMatch(/HTTP 400/)
    expect(err!.message.length).toBeLessThan(1024 + 256) // 1KB cap + framing
  })
  it('throws when the response has no operation name', async () => {
    nextResponse = JSON.stringify({ notName: 'x' })
    await expect(submitGeneration(cfg(), 'tok', opts())).rejects.toThrow(/operation name/i)
  })
})

describe('pollOperation', () => {
  const popts = () => ({ ...opts(), model: 'veo-3.1-generate-001' })
  it('done=false when the operation is still running', async () => {
    nextResponse = JSON.stringify({ done: false })
    const r = await pollOperation('op/1', 'tok', popts())
    expect(r.done).toBe(false)
  })
  it('extracts videos[0] uri/gcsUri when done', async () => {
    nextResponse = JSON.stringify({
      done: true,
      response: { videos: [{ uri: 'https://d/v.mp4', gcsUri: 'gs://b/v.mp4' }] },
    })
    const r = await pollOperation('op/1', 'tok', popts())
    expect(r.done).toBe(true)
    expect(r.videoUrl).toBe('https://d/v.mp4')
    expect(r.gcsUri).toBe('gs://b/v.mp4')
  })
  it('extracts inline bytesBase64Encoded + mimeType when done (REAL default Vertex shape, verified 2026-06-17)', async () => {
    // The real predictLongRunning response (no storageUri) delivers the video inline:
    //   response: { "@type": "...GenerateVideoResponse", raiMediaFilteredCount: 0,
    //               videos: [{ bytesBase64Encoded: "<b64>", mimeType: "video/mp4" }] }
    // There is NO uri/gcsUri in the default case — captured live against claude-ve.
    nextResponse = JSON.stringify({
      done: true,
      response: {
        '@type': 'type.googleapis.com/cloud.ai.large_models.vision.GenerateVideoResponse',
        raiMediaFilteredCount: 0,
        videos: [{ bytesBase64Encoded: 'AAECAwQF', mimeType: 'video/mp4' }],
      },
    })
    const r = await pollOperation('op/1', 'tok', popts())
    expect(r.done).toBe(true)
    expect(r.videoBytes).toBe('AAECAwQF')
    expect(r.mimeType).toBe('video/mp4')
    expect(r.videoUrl).toBeUndefined()
    expect(r.gcsUri).toBeUndefined()
    expect(r.raiFilteredCount).toBe(0)
  })
  it('surfaces raiMediaFilteredCount when the candidate was filtered (no video)', async () => {
    nextResponse = JSON.stringify({
      done: true,
      response: { raiMediaFilteredCount: 1, raiMediaFilteredReasons: ['blocked'], videos: [] },
    })
    const r = await pollOperation('op/1', 'tok', popts())
    expect(r.done).toBe(true)
    expect(r.raiFilteredCount).toBe(1)
    expect(r.videoBytes).toBeUndefined()
    expect(r.videoUrl).toBeUndefined()
    expect(r.gcsUri).toBeUndefined()
  })
  it('propagates error.message from the operation', async () => {
    nextResponse = JSON.stringify({ done: true, error: { message: 'quota exceeded' } })
    await expect(pollOperation('op/1', 'tok', popts())).rejects.toThrow(/quota exceeded/)
  })
})

describe('buildRequestBody — cross-cutting parameter passthrough', () => {
  it('maps every cross-cutting parameter that is set', () => {
    const body = buildRequestBody(cfg({
      aspectRatio: '9:16',
      durationSeconds: 8,
      resolution: '1080p',
      generateAudio: false,
      sampleCount: 2,
      seed: 42,
      negativePrompt: 'text, logos',
      enhancePrompt: false,
      storageUri: 'gs://b/o',
      personGeneration: 'allow_adult',
      addWatermark: false,
      includeRaiReason: true,
    })) as { instances: any[]; parameters: Record<string, unknown> }
    const p = body.parameters
    expect(p.aspectRatio).toBe('9:16')
    expect(p.durationSeconds).toBe(8)
    expect(p.resolution).toBe('1080p')
    expect(p.generateAudio).toBe(false)   // false must survive (not dropped as falsy)
    expect(p.sampleCount).toBe(2)
    expect(p.seed).toBe(42)
    expect(p.negativePrompt).toBe('text, logos')
    expect(p.enhancePrompt).toBe(false)
    expect(p.storageUri).toBe('gs://b/o')
    expect(p.personGeneration).toBe('allow_adult')
    expect(p.addWatermark).toBe(false)
    expect(p.includeRaiReason).toBe(true)
    expect(body.instances[0].prompt).toBe('a sunset')
  })

  it('omits parameters that are not set (no present-but-undefined keys)', () => {
    const body = buildRequestBody(cfg()) as { parameters: Record<string, unknown> }
    for (const key of [
      'aspectRatio', 'durationSeconds', 'resolution', 'generateAudio', 'sampleCount',
      'seed', 'negativePrompt', 'enhancePrompt', 'storageUri', 'personGeneration',
      'addWatermark', 'includeRaiReason',
    ]) {
      expect(key in body.parameters).toBe(false)
    }
  })

  it('drops videoExtensionInput from the request body (Rule #10 clean-call half)', () => {
    const body = buildRequestBody(cfg({ videoExtensionInput: 'op-name-or-uri' })) as {
      instances: any[]; parameters: Record<string, unknown>
    }
    expect('videoExtensionInput' in body.parameters).toBe(false)
    expect('videoExtensionInput' in body.instances[0]).toBe(false)
    expect(JSON.stringify(body)).not.toContain('op-name-or-uri')
  })
})
