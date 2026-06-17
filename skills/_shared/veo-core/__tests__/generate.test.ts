import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { _resetDefaultModelCacheForTests } from '@veo-core/constants'

vi.mock('@veo-core/auth', () => ({
  getAccessToken: vi.fn(async () => 'fake-token'),
}))

vi.mock('@veo-core/api', () => ({
  submitGeneration: vi.fn(async () => 'op/123'),
  // DEFAULT delivery (no storageUri) returns the video inline as bytesBase64Encoded,
  // NOT a uri/gcsUri (api.ts:135-138, verified live 2026-06-17). The default mock
  // mirrors that real shape so the headline test exercises the real default path.
  pollOperation: vi.fn(async () => ({
    done: true,
    videoUrl: undefined,
    gcsUri: undefined,
    videoBytes: 'AAECAwQF',
    mimeType: 'video/mp4',
    raiFilteredCount: 0,
    raw: {},
  })),
  downloadFile: vi.fn(async () => undefined),
  saveInlineVideo: vi.fn(async () => undefined),
}))

beforeEach(() => {
  _resetDefaultModelCacheForTests()
  vi.clearAllMocks()
  // Hermetic env: getProjectAndLocation() reads these. Stubbing here makes the
  // suite pass on a clean CI runner regardless of the developer's shell exports.
  vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'test-proj')
  vi.stubEnv('GOOGLE_CLOUD_LOCATION', 'us-central1')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

import { generateVideo } from '@veo-core/generate'
import * as api from '@veo-core/api'

describe('generateVideo', () => {
  it('returns valid GenerationResult and writes inline bytes on the default delivery (outputPath branch)', async () => {
    const r = await generateVideo({
      prompt: 'a sunset',
      outputPath: '/tmp/x.mp4',
    })
    expect(r.operationName).toBe('op/123')
    expect(r.model).toBe('veo-3.1-generate-001')
    expect(r.videoPath).toBe('/tmp/x.mp4')
    expect(r.gcsUri).toBeUndefined()
    // Default delivery is inline base64 -> saveInlineVideo, never downloadFile.
    expect(api.saveInlineVideo).toHaveBeenCalledWith('AAECAwQF', '/tmp/x.mp4')
    expect(api.downloadFile).not.toHaveBeenCalled()
    // Env wiring is real behavior, not incidental: the stubbed project/location
    // must reach submitGeneration and pollOperation.
    expect(api.submitGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { projectId: 'test-proj', location: 'us-central1' }
    )
    expect(api.pollOperation).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ projectId: 'test-proj', location: 'us-central1' })
    )
  })

  it('downloads via downloadFile when poll returns a fetchable URL (URL-delivery mode)', async () => {
    ;(api.pollOperation as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      done: true,
      videoUrl: 'https://download.example/video.mp4',
      gcsUri: undefined,
      videoBytes: undefined,
      raw: {},
    })
    const r = await generateVideo({ prompt: 'a sunset', outputPath: '/tmp/x.mp4' })
    expect(r.videoPath).toBe('/tmp/x.mp4')
    expect(api.downloadFile).toHaveBeenCalledTimes(1)
    expect(api.downloadFile).toHaveBeenCalledWith(
      'https://download.example/video.mp4',
      '/tmp/x.mp4',
      expect.anything()
    )
    expect(api.saveInlineVideo).not.toHaveBeenCalled()
  })

  it('skips download when storageUri is set (gcsUri branch)', async () => {
    ;(api.pollOperation as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      done: true,
      videoUrl: undefined,
      gcsUri: 'gs://bucket/obj.mp4',
      raw: {},
    })
    const r = await generateVideo({
      prompt: 'a sunset',
      storageUri: 'gs://bucket/obj.mp4',
    })
    expect(r.gcsUri).toBe('gs://bucket/obj.mp4')
    expect(r.videoPath).toBeUndefined()
    expect(api.downloadFile).not.toHaveBeenCalled()
  })

  it('throws when validation fails (Foundation contract: validateConfig never throws, generateVideo does)', async () => {
    await expect(
      generateVideo({ prompt: 'x' } as never) // missing outputPath/storageUri => rule #9
    ).rejects.toThrow(/output destination required/i)
  })

  it('writes inline base64 video when poll returns videoBytes (REAL default Vertex delivery)', async () => {
    // Default delivery (no storageUri) returns the video inline as bytesBase64Encoded,
    // NOT a uri/gcsUri. Verified live against claude-ve 2026-06-17.
    ;(api.pollOperation as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      done: true,
      videoUrl: undefined,
      gcsUri: undefined,
      videoBytes: 'AAECAwQF',
      mimeType: 'video/mp4',
      raiFilteredCount: 0,
      raw: {},
    })
    const r = await generateVideo({ prompt: 'a sunset', outputPath: '/tmp/inline.mp4' })
    expect(r.videoPath).toBe('/tmp/inline.mp4')
    expect(api.saveInlineVideo).toHaveBeenCalledWith('AAECAwQF', '/tmp/inline.mp4')
    expect(api.downloadFile).not.toHaveBeenCalled()
  })

  it('throws a Responsible-AI error when all candidates were filtered (no video)', async () => {
    ;(api.pollOperation as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      done: true,
      videoUrl: undefined,
      gcsUri: undefined,
      videoBytes: undefined,
      raiFilteredCount: 1,
      raw: {},
    })
    await expect(
      generateVideo({ prompt: 'a sunset', outputPath: '/tmp/x.mp4' })
    ).rejects.toThrow(/responsible ai|filter/i)
  })
})
