// generate.ts — orchestrator: auth -> validate -> submit -> poll -> download/skip.
import { getAccessToken } from '@veo-core/auth'
import { submitGeneration, pollOperation, downloadFile } from '@veo-core/api'
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

  // Local download. videoUrl may be https:// or gs:// — downloadFile handles both.
  const target = poll.gcsUri ?? poll.videoUrl
  if (!target) throw new Error('generateVideo: no download target in poll result')
  await downloadFile(target, resolved.outputPath!, token)
  result.videoPath = resolved.outputPath
  return result
}
