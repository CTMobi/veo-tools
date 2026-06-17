// validation.ts — FOUNDATION_RULES + createValidator factory + validateConfig.
// validateConfig NEVER throws; it returns a discriminated union.
import type {
  VeoConfig,
  ValidationResult,
  ValidationRule,
  RuleResult,
  ExecutionContext,
} from '@veo-core/types'
import {
  MODEL_DURATIONS,
  MODEL_SAMPLE_MAX,
  TOKEN_WARNING_THRESHOLD,
  RESTRICTED_PERSON_REGIONS,
  detectRegion,
  resolveDefaultModel,
} from '@veo-core/constants'

// ---------- token estimator (Latin-script approx; future round may add multipliers) ----------
function estimateTokens(s: string): number {
  return Math.ceil(s.length / 3.5)
}

// ---------- FOUNDATION_RULES ----------
const ruleDurationsPerModel: ValidationRule = (c) => {
  if (c.durationSeconds === undefined) return { kind: 'ok' }
  const allowed = MODEL_DURATIONS.get(c.model!)
  if (!allowed) {
    return { kind: 'warning', message: `duration not validated against unknown model ${c.model}; proceed at your own risk` }
  }
  if (!allowed.has(c.durationSeconds)) {
    return {
      kind: 'error',
      message: `durationSeconds ${c.durationSeconds} not allowed for model ${c.model}; supported: {${[...allowed].join(',')}}`,
      suggestion: `pick one of {${[...allowed].join(',')}}`,
    }
  }
  return { kind: 'ok' }
}

const ruleHighResRequiresDuration8: ValidationRule = (c) => {
  if (c.resolution !== '1080p' && c.resolution !== '4k') return { kind: 'ok' }
  if (c.durationSeconds === undefined) {
    return {
      kind: 'autoFix',
      patch: { durationSeconds: 8 },
      message: 'Bumped duration to 8s to enable 1080p/4K',
    }
  }
  if (c.durationSeconds !== 8) {
    return {
      kind: 'error',
      message: `1080p/4K require duration=8; got duration=${c.durationSeconds}.`,
      suggestion: 'Either drop --duration (auto-fixes to 8) or change --resolution to 720p.',
    }
  }
  return { kind: 'ok' }
}

const ruleVeo2NoAudio: ValidationRule = (c) => {
  if (!c.model?.startsWith('veo-2')) return { kind: 'ok' }
  if (c.generateAudio === undefined) {
    return {
      kind: 'autoFix',
      patch: { generateAudio: false },
      message: "Veo 2 doesn't support audio, disabled",
    }
  }
  if (c.generateAudio === true) {
    return {
      kind: 'error',
      message: 'Veo 2 does not support audio. Pass --no-audio or switch to a Veo 3 model.',
    }
  }
  return { kind: 'ok' }
}

const ruleVeo2Max720p: ValidationRule = (c) => {
  if (!c.model?.startsWith('veo-2')) return { kind: 'ok' }
  if (c.resolution === undefined) return { kind: 'ok' } // default will be 720p
  if (c.resolution !== '720p') {
    return {
      kind: 'error',
      message: `Veo 2 max resolution is 720p; got ${c.resolution}.`,
      suggestion: 'Drop --resolution or switch to a Veo 3 model.',
    }
  }
  return { kind: 'ok' }
}

const ruleTokenWarning: ValidationRule = (c) => {
  if (c.prompt === undefined) return { kind: 'ok' }
  const t = estimateTokens(c.prompt)
  if (t > TOKEN_WARNING_THRESHOLD) {
    return { kind: 'warning', message: `prompt is approximately ${t} tokens (>${TOKEN_WARNING_THRESHOLD}); server may truncate or reject` }
  }
  return { kind: 'ok' }
}

const rulePersonGenerationRegion: ValidationRule = (c, ctx) => {
  if (c.personGeneration !== 'allow_all') return { kind: 'ok' }
  const restricted = ctx.region && (RESTRICTED_PERSON_REGIONS as readonly string[]).includes(ctx.region)
  if (!restricted) return { kind: 'ok' }
  return {
    kind: 'autoFix',
    patch: { personGeneration: 'allow_adult' },
    message: `Region restriction (${ctx.region}): personGeneration set to allow_adult`,
  }
}

const ruleSampleCountPerModel: ValidationRule = (c) => {
  if (c.sampleCount === undefined) return { kind: 'ok' }
  if (!Number.isInteger(c.sampleCount)) {
    return {
      kind: 'error',
      message: `sampleCount must be an integer; got ${c.sampleCount}`,
      suggestion: 'pass a whole number (e.g. 1, 2)',
    }
  }
  const max = MODEL_SAMPLE_MAX[c.model!]
  if (max === undefined) {
    return { kind: 'warning', message: `sampleCount not validated against unknown model ${c.model}` }
  }
  if (c.sampleCount < 1 || c.sampleCount > max) {
    return {
      kind: 'error',
      message: `sampleCount out of range for ${c.model}: ${c.sampleCount} (allowed: 1..${max})`,
    }
  }
  return { kind: 'ok' }
}

const ruleAspectRatioEnum: ValidationRule = (c) => {
  if (c.aspectRatio === undefined) return { kind: 'ok' }
  if (c.aspectRatio !== '16:9' && c.aspectRatio !== '9:16') {
    return { kind: 'error', message: `Invalid aspect ratio: ${c.aspectRatio}` }
  }
  return { kind: 'ok' }
}

// Rule #9 — outputPath XOR storageUri. The single explicit undefined-guard exception.
const ruleOutputXor: ValidationRule = (c) => {
  // A field that is present but empty/whitespace-only is unusable as a destination.
  // Surface that explicitly rather than letting it pass the presence check.
  if (c.outputPath !== undefined && c.outputPath.trim() === '') {
    return { kind: 'error', message: 'outputPath cannot be empty' }
  }
  if (c.storageUri !== undefined && c.storageUri.trim() === '') {
    return { kind: 'error', message: 'storageUri cannot be empty' }
  }
  const hasOut = c.outputPath !== undefined
  const hasGcs = c.storageUri !== undefined
  if (!hasOut && !hasGcs) {
    return { kind: 'error', message: 'Output destination required: set outputPath or storageUri' }
  }
  if (hasOut && hasGcs) {
    return { kind: 'error', message: 'Ambiguous output: set either outputPath or storageUri, not both' }
  }
  return { kind: 'ok' }
}

const FORWARD_DECLARED_FIELDS: Array<keyof VeoConfig> = ['videoExtensionInput']
const ruleForwardDeclaredWarning: ValidationRule = (c) => {
  for (const f of FORWARD_DECLARED_FIELDS) {
    if (c[f] !== undefined) {
      return {
        kind: 'warning',
        message: `${String(f)} is declared on VeoConfig for forward-compat but Foundation does not implement it; the owning sub-project will.`,
      }
    }
  }
  return { kind: 'ok' }
}

// #11 — Veo 3 forbids disabling prompt enhancement. Discovered in the M13 probe
// pass (2026-06-17): Vertex rejects enhancePrompt=false on Veo 3 at runtime with
// "Veo 3 prompt enhancement cannot be disabled." Catch it before the paid call.
// Guards undefined (only an explicit `false` trips it; rule #9-style exception
// not needed since `!== false` already short-circuits undefined/true).
const ruleVeo3NoDisableEnhance: ValidationRule = (c) => {
  if (c.enhancePrompt !== false) return { kind: 'ok' }
  if (!c.model?.startsWith('veo-3')) return { kind: 'ok' }
  return {
    kind: 'error',
    message:
      'Veo 3 models do not support disabling prompt enhancement (enhancePrompt is always on). ' +
      'Remove --no-enhance-prompt, or switch to a Veo 2 model.',
  }
}

export const FOUNDATION_RULES: ValidationRule[] = [
  ruleDurationsPerModel,              // #1
  ruleHighResRequiresDuration8,       // #2
  ruleVeo2NoAudio,                    // #3
  ruleVeo2Max720p,                    // #4
  ruleTokenWarning,                   // #5
  rulePersonGenerationRegion,         // #6
  ruleSampleCountPerModel,            // #7
  ruleAspectRatioEnum,                // #8
  ruleOutputXor,                      // #9
  ruleForwardDeclaredWarning,         // #10
  ruleVeo3NoDisableEnhance,           // #11
]

// ---------- factory ----------
export function createValidator(opts: {
  baseRules?: ValidationRule[]
  extraRules?: ValidationRule[]
}): (config: VeoConfig, context?: ExecutionContext) => ValidationResult {
  const rules = [...(opts.baseRules ?? FOUNDATION_RULES), ...(opts.extraRules ?? [])]
  return (config, context) => {
    // Resolve context once at construction-time defaults from env vars when omitted.
    const ctx: ExecutionContext = context ?? {
      region: detectRegion(process.env.GOOGLE_CLOUD_LOCATION, process.env.VEO_REGION),
    }

    // Step 1 — resolve default model
    const working: VeoConfig = { ...config }
    if (working.model === undefined) {
      try {
        working.model = resolveDefaultModel()
      } catch (e) {
        return {
          valid: false,
          errors: [(e as Error).message],
          suggestions: ['Update constants.ts via the maintenance protocol (§6)'],
        }
      }
    }

    // Step 2 — run rules
    const warnings: string[] = []
    const errors: string[] = []
    const suggestions: string[] = []
    const autoFixMessages: string[] = []

    for (const rule of rules) {
      let res: RuleResult
      try {
        res = rule(working, ctx)
      } catch (e) {
        errors.push(`Rule ${rule.name || '<anonymous>'} threw: ${(e as Error).message}`)
        suggestions.push("Report this to the rule's owning sub-project")
        continue
      }
      switch (res.kind) {
        case 'ok': break
        case 'warning': warnings.push(res.message); break
        case 'error':
          errors.push(res.message)
          if (res.suggestion) suggestions.push(res.suggestion)
          break
        case 'autoFix':
          Object.assign(working, res.patch)
          autoFixMessages.push(res.message)
          break
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors, suggestions }
    }

    // Step 3 — apply remaining silent defaults (NOT included in autoFixMessages)
    if (working.aspectRatio   === undefined) working.aspectRatio   = '16:9'
    if (working.resolution    === undefined) working.resolution    = '720p'
    if (working.durationSeconds === undefined) working.durationSeconds = 8
    if (working.sampleCount   === undefined) working.sampleCount   = 1
    if (working.generateAudio === undefined) {
      // Library default: true (Veo 3.x native default). Skill use-case-aware
      // override happens upstream in SKILL.md Phase 1, not here.
      working.generateAudio = !working.model!.startsWith('veo-2')
    }

    return { valid: true, warnings, autoFixed: working, autoFixMessages }
  }
}

export const validateConfig = createValidator({ baseRules: FOUNDATION_RULES })
