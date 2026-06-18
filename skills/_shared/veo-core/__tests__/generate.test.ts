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

  it('storageUri branch: throws a Responsible-AI error when no gcsUri and candidates were filtered', async () => {
    ;(api.pollOperation as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      done: true,
      videoUrl: undefined,
      gcsUri: undefined,
      videoBytes: undefined,
      raiFilteredCount: 2,
      raw: {},
    })
    await expect(
      generateVideo({ prompt: 'a sunset', storageUri: 'gs://bucket/obj.mp4' })
    ).rejects.toThrow(/responsible ai|filter/i)
    expect(api.downloadFile).not.toHaveBeenCalled()
  })

  it('storageUri branch: throws a no-output error when neither gcsUri nor rai-filter', async () => {
    ;(api.pollOperation as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      done: true,
      videoUrl: undefined,
      gcsUri: undefined,
      videoBytes: undefined,
      raiFilteredCount: 0,
      raw: {},
    })
    await expect(
      generateVideo({ prompt: 'a sunset', storageUri: 'gs://bucket/obj.mp4' })
    ).rejects.toThrow(/no server-side output/i)
    expect(api.downloadFile).not.toHaveBeenCalled()
  })

  it('storageUri branch: succeeds when the GCS URI arrives in videoUrl (gs://) with no gcsUri (GEM-A)', async () => {
    ;(api.pollOperation as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      done: true,
      videoUrl: 'gs://b/o',
      gcsUri: undefined,
      videoBytes: undefined,
      raiFilteredCount: 0,
      raw: {},
    })
    const r = await generateVideo({ prompt: 'a sunset', storageUri: 'gs://b/o' })
    expect(r.gcsUri).toBe('gs://b/o')
    expect(r.videoPath).toBeUndefined()
    expect(api.downloadFile).not.toHaveBeenCalled()
  })

  it('honors GOOGLE_CLOUD_PROJECT_ID alone (backwards-compat fallback, GEM-B)', async () => {
    vi.stubEnv('GOOGLE_CLOUD_PROJECT', '')
    vi.stubEnv('GOOGLE_CLOUD_PROJECT_ID', 'legacy-proj')
    await generateVideo({ prompt: 'a sunset', outputPath: '/tmp/x.mp4' })
    expect(api.submitGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ projectId: 'legacy-proj' })
    )
  })

  it('prefers GOOGLE_CLOUD_PROJECT over GOOGLE_CLOUD_PROJECT_ID when both are set (GEM-B precedence)', async () => {
    vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'primary')
    vi.stubEnv('GOOGLE_CLOUD_PROJECT_ID', 'legacy')
    await generateVideo({ prompt: 'a sunset', outputPath: '/tmp/x.mp4' })
    expect(api.submitGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ projectId: 'primary' })
    )
  })

  it('warns about silent data loss when sampleCount > 1 (CLAUDE-1)', async () => {
    const r = await generateVideo({
      prompt: 'a sunset',
      outputPath: '/tmp/x.mp4',
      sampleCount: 3,
    })
    expect(r.warnings.some((w) => /sampleCount=3/.test(w) && /only the first video/i.test(w))).toBe(true)
  })

  it('forwards the validator autoFixMessages on the result (CLAUDE-LOW-1)', async () => {
    // Veo 2 with unspecified audio => rule #3 auto-fixes generateAudio=false with a message.
    const r = await generateVideo({
      prompt: 'a sunset',
      model: 'veo-2.0-generate-001',
      outputPath: '/tmp/x.mp4',
    })
    expect(Array.isArray(r.autoFixMessages)).toBe(true)
    expect(r.autoFixMessages!.some((m) => /audio/i.test(m))).toBe(true)
  })

  it('survives a transient poll failure (high load) and then succeeds (GEM-NEW-2)', async () => {
    // First poll throws a transient "high load... try again later" error; the loop
    // should swallow it, sleep one POLL_INTERVAL, and the retry resolves done.
    ;(api.pollOperation as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(
        new Error('The service is currently experiencing high load... Please try again later.')
      )
      .mockResolvedValueOnce({
        done: true,
        videoUrl: undefined,
        gcsUri: undefined,
        videoBytes: 'AAECAwQF',
        mimeType: 'video/mp4',
        raiFilteredCount: 0,
        raw: {},
      })
    vi.useFakeTimers()
    try {
      const p = generateVideo({ prompt: 'a sunset', outputPath: '/tmp/x.mp4' })
      // Cross the 5s POLL_INTERVAL sleep without a real wait. Multiple advances are
      // harmless and ensure the retry poll runs before we await the result.
      await vi.advanceTimersByTimeAsync(5_000)
      await vi.advanceTimersByTimeAsync(5_000)
      const r = await p
      expect(r.videoPath).toBe('/tmp/x.mp4')
      expect(api.pollOperation).toHaveBeenCalledTimes(2)
      expect(api.saveInlineVideo).toHaveBeenCalledWith('AAECAwQF', '/tmp/x.mp4')
    } finally {
      vi.useRealTimers()
    }
  })

  it('survives a transient 502 Bad Gateway poll failure and then succeeds (PR5-R4 G4)', async () => {
    ;(api.pollOperation as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('502 Bad Gateway'))
      .mockResolvedValueOnce({
        done: true,
        videoUrl: undefined,
        gcsUri: undefined,
        videoBytes: 'AAECAwQF',
        mimeType: 'video/mp4',
        raiFilteredCount: 0,
        raw: {},
      })
    vi.useFakeTimers()
    try {
      const p = generateVideo({ prompt: 'a sunset', outputPath: '/tmp/x.mp4' })
      await vi.advanceTimersByTimeAsync(5_000)
      await vi.advanceTimersByTimeAsync(5_000)
      const r = await p
      expect(r.videoPath).toBe('/tmp/x.mp4')
      expect(api.pollOperation).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rethrows a permanent poll error promptly without retrying to the deadline (GEM-NEW-2)', async () => {
    // A permanent error (e.g. invalid argument) must NOT be retried: generateVideo
    // rejects immediately with that message, and pollOperation is called exactly once.
    ;(api.pollOperation as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Invalid argument')
    )
    await expect(
      generateVideo({ prompt: 'a sunset', outputPath: '/tmp/x.mp4' })
    ).rejects.toThrow(/invalid argument/i)
    expect(api.pollOperation).toHaveBeenCalledTimes(1)
  })

  it('does not misclassify a permanent error whose text incidentally contains "503" as transient', async () => {
    // Status codes are anchored on non-digit boundaries, so an unrelated "503" in a
    // permanent error body (here an id) must NOT trigger the transient retry.
    ;(api.pollOperation as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Permission denied for resource abc503def')
    )
    await expect(
      generateVideo({ prompt: 'a sunset', outputPath: '/tmp/x.mp4' })
    ).rejects.toThrow(/permission denied/i)
    expect(api.pollOperation).toHaveBeenCalledTimes(1)
  })

  it('exhausts transient retries on the 6th consecutive transient error and rejects (off-by-one boundary)', async () => {
    // 6 consecutive transient errors: the loop tolerates 5 retries (transientFailures
    // 1..5), and the 6th catch finds transientFailures (5) < 5 == false, so it rethrows.
    // pollOperation is therefore called exactly 6 times (initial + 5 retries).
    ;(api.pollOperation as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error('The service is experiencing high load, try again later.'))
    vi.useFakeTimers()
    try {
      const p = generateVideo({ prompt: 'a sunset', outputPath: '/tmp/x.mp4' })
      // Attach a rejection handler up front so the unhandled-rejection guard doesn't
      // fire while we step the fake timers across the 5 POLL_INTERVAL sleeps.
      const assertion = expect(p).rejects.toThrow(/high load/i)
      for (let i = 0; i < 6; i++) {
        await vi.advanceTimersByTimeAsync(5_000)
      }
      await assertion
      expect(api.pollOperation).toHaveBeenCalledTimes(6)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects with a polling-timeout error when the operation never completes (timeout path)', async () => {
    // pollOperation always resolves done:false, so the while(Date.now() < deadline)
    // loop runs until the 10-minute deadline elapses, then throws. Drive the deadline
    // with fake timers instead of waiting 10 real minutes.
    ;(api.pollOperation as ReturnType<typeof vi.fn>).mockResolvedValue({
      done: false,
      videoUrl: undefined,
      gcsUri: undefined,
      videoBytes: undefined,
      raiFilteredCount: 0,
      raw: {},
    })
    vi.useFakeTimers()
    try {
      const p = generateVideo({ prompt: 'a sunset', outputPath: '/tmp/x.mp4' })
      const assertion = expect(p).rejects.toThrow(/polling timed out/i)
      // Advance past POLL_TIMEOUT_MS (10 min) in 5s steps so each loop iteration's
      // setTimeout resolves and Date.now() advances toward the deadline. 130 steps
      // (650s) comfortably crosses the 600s deadline.
      for (let i = 0; i < 130; i++) {
        await vi.advanceTimersByTimeAsync(5_000)
      }
      await assertion
    } finally {
      vi.useRealTimers()
    }
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
