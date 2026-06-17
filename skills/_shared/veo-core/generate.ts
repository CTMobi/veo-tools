// generate.ts — orchestrator: auth -> validate -> submit -> poll -> download/skip.
import { getAccessToken } from '@veo-core/auth'
import { submitGeneration, pollOperation, downloadFile, saveInlineVideo } from '@veo-core/api'
import { validateConfig } from '@veo-core/validation'
import type { VeoConfig, GenerationResult } from '@veo-core/types'

const POLL_INTERVAL_MS = 5_000
const POLL_TIMEOUT_MS  = 10 * 60 * 1000
// Max CONSECUTIVE transient poll failures tolerated before giving up. Resets to 0 on
// any successful poll, so it bounds a burst of glitches, not the total run length.
const POLL_MAX_TRANSIENT_RETRIES = 5

// isTransientPollError — true only for retryable, NON-permanent poll failures (high
// load, rate limits, 5xx, network resets). Permanent errors (auth 4xx, RAI / invalid
// operation messages thrown via parsed.error.message) must NOT match, so we fail fast
// instead of spinning uselessly until the deadline.
function isTransientPollError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase()
  return /high load|try again|temporarily|unavailable|timed out|timeout|econnreset|etimedout|socket hang up|503|429/.test(
    msg
  )
}

function getProjectAndLocation(): { projectId: string; location: string } {
  // Backwards-compat: the pre-refactor veo-generate.ts read GOOGLE_CLOUD_PROJECT ||
  // GOOGLE_CLOUD_PROJECT_ID. Preserve the GOOGLE_CLOUD_PROJECT_ID fallback so existing
  // environments that set only the *_ID variant keep working.
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID
  const location  = process.env.GOOGLE_CLOUD_LOCATION ?? 'us-central1'
  if (!projectId) throw new Error('GOOGLE_CLOUD_PROJECT env var is required')
  return { projectId, location }
}

export async function generateVideo(config: VeoConfig): Promise<GenerationResult> {
  const v = validateConfig(config)
  if (!v.valid) {
    throw new Error(`Validation failed: ${v.errors.join('; ')}. ${v.suggestions.join(' ')}`)
  }
  const resolved = v.autoFixed
  const token = await getAccessToken()
  const { projectId, location } = getProjectAndLocation()

  const operationName = await submitGeneration(resolved, token, { projectId, location })

  const deadline = Date.now() + POLL_TIMEOUT_MS
  let poll: Awaited<ReturnType<typeof pollOperation>> = { done: false, raw: {} }
  let transientFailures = 0
  while (Date.now() < deadline) {
    try {
      poll = await pollOperation(operationName, token, {
        projectId,
        location,
        model: resolved.model!,
      })
      transientFailures = 0
      if (poll.done) break
    } catch (e) {
      // Retry ONLY transient glitches, and only for a bounded burst. Permanent
      // errors (auth, RAI, invalid operation) rethrow immediately — no point
      // hammering the API until the 10-minute deadline.
      if (isTransientPollError(e) && transientFailures < POLL_MAX_TRANSIENT_RETRIES) {
        transientFailures++
        // fall through to the sleep + retry below
      } else {
        throw e
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  if (!poll.done) throw new Error(`generateVideo: polling timed out after ${POLL_TIMEOUT_MS}ms`)

  const result: GenerationResult = {
    operationName,
    model:           resolved.model!,
    durationSeconds: resolved.durationSeconds!,
    resolution:      resolved.resolution!,
    warnings:        v.warnings,
    // Forward the validator's auto-fix messages (Veo2 audio off, duration bump,
    // region adjust) so live (non-dry-run) callers can see what was changed.
    autoFixMessages: v.autoFixMessages,
  }

  // sampleCount > 1 silent data loss: pollOperation returns only videos[0], so the
  // user paid for N videos but Foundation retrieves only the first. Surface a warning
  // rather than silently dropping (and billing for) the rest.
  if (resolved.sampleCount && resolved.sampleCount > 1) {
    result.warnings.push(
      `sampleCount=${resolved.sampleCount} requested but Foundation returns only the first video; ` +
        `the others are generated and billed but not retrieved.`
    )
  }

  if (resolved.storageUri !== undefined) {
    // Server-side delivery — no download. Mirror the local branch: a missing gcsUri
    // is NOT success. Distinguish RAI-filtered (every candidate suppressed) from a
    // generic no-output result so the error is actionable. The GCS URI may arrive in
    // poll.gcsUri OR in poll.videoUrl (videos[0].uri) when it starts with 'gs://'.
    const serverGcsUri =
      poll.gcsUri ?? (poll.videoUrl?.startsWith('gs://') ? poll.videoUrl : undefined)
    if (serverGcsUri) {
      result.gcsUri = serverGcsUri
      return result
    }
    if (poll.raiFilteredCount && poll.raiFilteredCount > 0) {
      throw new Error(
        `generateVideo: all ${poll.raiFilteredCount} candidate(s) were blocked by the Responsible AI filter. ` +
          `Revise the prompt (e.g. remove sensitive content), or pass includeRaiReason to surface the specific reason.`
      )
    }
    throw new Error('generateVideo: no server-side output produced (storageUri delivery returned no gcsUri)')
  }

  // Local delivery. Three real cases, in priority order:
  //  1. gcsUri / videoUrl  — a fetchable URL (https:// or gs://). downloadFile handles both.
  //  2. videoBytes         — the DEFAULT: the video is inlined as base64 in the poll
  //                          response (verified live 2026-06-17). Decode + atomic write.
  //  3. neither, raiFilteredCount > 0 — every candidate was suppressed by the
  //                          Responsible-AI filter. Surface a clear, actionable error.
  const target = poll.gcsUri ?? poll.videoUrl
  if (target) {
    await downloadFile(target, resolved.outputPath!, token)
  } else if (poll.videoBytes) {
    await saveInlineVideo(poll.videoBytes, resolved.outputPath!)
  } else if (poll.raiFilteredCount && poll.raiFilteredCount > 0) {
    throw new Error(
      `generateVideo: all ${poll.raiFilteredCount} candidate(s) were blocked by the Responsible AI filter. ` +
        `Revise the prompt (e.g. remove sensitive content), or pass includeRaiReason to surface the specific reason.`
    )
  } else {
    throw new Error('generateVideo: no download target in poll result')
  }
  result.videoPath = resolved.outputPath
  return result
}
