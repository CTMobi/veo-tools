import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { _resetDefaultModelCacheForTests } from '@veo-core/constants'

vi.mock('@veo-core/auth', () => ({
  getAccessToken: vi.fn(async () => 'fake-token'),
}))

vi.mock('@veo-core/api', () => ({
  submitGeneration: vi.fn(async () => 'op/123'),
  pollOperation: vi.fn(async () => ({
    done: true,
    videoUrl: 'https://download.example/video.mp4',
    gcsUri: undefined,
    raw: {},
  })),
  downloadFile: vi.fn(async () => undefined),
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
  it('returns valid GenerationResult when validation passes (outputPath branch)', async () => {
    const r = await generateVideo({
      prompt: 'a sunset',
      outputPath: '/tmp/x.mp4',
    })
    expect(r.operationName).toBe('op/123')
    expect(r.model).toBe('veo-3.1-generate-001')
    expect(r.videoPath).toBe('/tmp/x.mp4')
    expect(r.gcsUri).toBeUndefined()
    expect(api.downloadFile).toHaveBeenCalledTimes(1)
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
})
