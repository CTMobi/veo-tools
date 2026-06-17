import { describe, it, expect, vi, beforeEach } from 'vitest'
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
