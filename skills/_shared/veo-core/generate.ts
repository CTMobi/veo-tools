// generate.ts — orchestrator: auth -> validate -> submit -> poll -> download/skip.
import { getAccessToken } from '@veo-core/auth'
import { submitGeneration, pollOperation, downloadFile, saveInlineVideo } from '@veo-core/api'
import { validateConfig } from '@veo-core/validation'
import type { VeoConfig, GenerationResult } from '@veo-core/types'

const POLL_INTERVAL_MS = 5_000
const POLL_TIMEOUT_MS  = 10 * 60 * 1000

function getProjectAndLocation(): { projectId: string; location: string } {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT
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
  while (Date.now() < deadline) {
    poll = await pollOperation(operationName, token, {
      projectId,
      location,
      model: resolved.model!,
    })
    if (poll.done) break
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  if (!poll.done) throw new Error(`generateVideo: polling timed out after ${POLL_TIMEOUT_MS}ms`)

  const result: GenerationResult = {
    operationName,
    model:           resolved.model!,
    durationSeconds: resolved.durationSeconds!,
    resolution:      resolved.resolution!,
    warnings:        v.warnings,
  }

  if (resolved.storageUri !== undefined) {
    // Server-side delivery — no download.
    result.gcsUri = poll.gcsUri ?? resolved.storageUri
    return result
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
