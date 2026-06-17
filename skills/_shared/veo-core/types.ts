// types.ts — Veo Foundation type surface. No runtime exports.

export interface VeoConfig {
  // Foundation-owned (validated and consumed here)
  prompt: string
  model?: string
  aspectRatio?: '16:9' | '9:16'
  durationSeconds?: number
  resolution?: '720p' | '1080p' | '4k'
  generateAudio?: boolean
  sampleCount?: number
  seed?: number
  negativePrompt?: string
  enhancePrompt?: boolean
  storageUri?: string
  personGeneration?: 'allow_all' | 'allow_adult' | 'disallow'
  addWatermark?: boolean
  includeRaiReason?: boolean
  outputPath?: string

  // Forward-declared (validation/semantics added by sub-projects)
  image?: ImageInput
  lastFrame?: ImageInput
  referenceImages?: ImageInput[]
  videoExtensionInput?: string
}

export type GenerationResult = {
  videoPath?: string
  gcsUri?: string
  operationName: string
  model: string
  durationSeconds: number
  resolution: string
  warnings: string[]
  autoFixMessages?: string[]
}

export type ImageInput =
  | { path: string;     mimeType?: string }
  | { buffer: Buffer;   mimeType: string }
  | { gcsUri: string;   mimeType?: string }

export type VertexImage =
  | { bytesBase64Encoded: string; mimeType: string }
  | { gcsUri: string;             mimeType?: string }

export type ExecutionContext = {
  region?: 'us' | 'eu' | 'uk' | 'ch' | 'mena' | 'other'
}

export type RuleResult =
  | { kind: 'ok' }
  | { kind: 'warning'; message: string }
  | { kind: 'error'; message: string; suggestion?: string }
  | { kind: 'autoFix'; patch: Partial<VeoConfig>; message: string }

export type ValidationRule = (config: VeoConfig, ctx: ExecutionContext) => RuleResult

export type ValidationResult =
  | {
      valid: true
      warnings: string[]
      autoFixed: VeoConfig
      autoFixMessages: string[]
    }
  | {
      valid: false
      errors: string[]
      suggestions: string[]
    }
