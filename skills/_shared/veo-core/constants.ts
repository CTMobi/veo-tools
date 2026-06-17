// constants.ts — frozen Veo lookup tables. Source: Vertex AI Veo docs, 2026-06-16.
// Last reviewed: 2026-06-16

export const AVAILABLE_MODELS: ReadonlySet<string> = new Set([
  'veo-3.1-generate-001',         // GA 17 Nov 2025
  'veo-3.1-fast-generate-001',    // GA 17 Nov 2025
  'veo-3.1-lite-generate-001',    // Preview 2 Apr 2026 (no referenceImages, no extension)
  'veo-3.0-generate-001',         // GA — DEPRECATED, discontinuation 30 Jun 2026
  'veo-3.0-fast-generate-001',    // GA — DEPRECATED, discontinuation 30 Jun 2026
  'veo-2.0-generate-001',         // deprecated per Gemini docs; no audio
])

export const DEFAULT_MODEL_CHAIN = [
  'veo-3.1-generate-001',         // GA quality model
  'veo-3.1-fast-generate-001',    // GA fallback in same generation
] as const

export const MODEL_DURATIONS: ReadonlyMap<string, ReadonlySet<number>> = new Map([
  ['veo-3.1-generate-001',      new Set([4, 6, 8])],
  ['veo-3.1-fast-generate-001', new Set([4, 6, 8])],
  ['veo-3.1-lite-generate-001', new Set([4, 6, 8])],
  ['veo-3.0-generate-001',      new Set([4, 6, 8])],
  ['veo-3.0-fast-generate-001', new Set([4, 6, 8])],
  ['veo-2.0-generate-001',      new Set([5, 6, 8])], // 7 is NOT accepted (Gemini API doc 2026-06-16)
])

export const MODEL_SAMPLE_MAX: Readonly<Record<string, number>> = Object.freeze({
  'veo-3.1-generate-001':      4,
  'veo-3.1-fast-generate-001': 4,
  'veo-3.1-lite-generate-001': 4, // verified live in M13 probe pass (2026-06-17): sampleCount=4 accepted
  'veo-3.0-generate-001':      4,
  'veo-3.0-fast-generate-001': 4,
  'veo-2.0-generate-001':      2,
})

export const AUDIO_DEFAULTS: Readonly<Record<string, boolean>> = Object.freeze({
  'hero-background': false,
  ambient:           false,
  loop:              false,
  social:            true,
  marketing:         true,
  product:           true,
  storytelling:      true,
})
// Callers fall through to true (Veo 3.1 API native default) for unspecified use cases:
// AUDIO_DEFAULTS[useCase] ?? true

export const DURATION_SUGGESTIONS: Readonly<Record<string, number>> = Object.freeze({
  'hero-background': 4,
  ambient:           4,
  loop:              4,
  social:            8,
  marketing:         8,
  product:           8,
  storytelling:      8,
})
// Callers fall through to the CLI default (8) for unspecified use cases.

export const MODEL_SUGGESTIONS: Readonly<
  Record<string, { quality: string; fast: string; lite?: string }>
> = Object.freeze({
  'hero-background': { quality: 'veo-3.1-generate-001', fast: 'veo-3.1-fast-generate-001', lite: 'veo-3.1-lite-generate-001' },
  ambient:           { quality: 'veo-3.1-generate-001', fast: 'veo-3.1-fast-generate-001', lite: 'veo-3.1-lite-generate-001' },
  loop:              { quality: 'veo-3.1-generate-001', fast: 'veo-3.1-fast-generate-001', lite: 'veo-3.1-lite-generate-001' },
  social:            { quality: 'veo-3.1-generate-001', fast: 'veo-3.1-fast-generate-001' },
  marketing:         { quality: 'veo-3.1-generate-001', fast: 'veo-3.1-fast-generate-001' },
  product:           { quality: 'veo-3.1-generate-001', fast: 'veo-3.1-fast-generate-001' },
  storytelling:      { quality: 'veo-3.1-generate-001', fast: 'veo-3.1-fast-generate-001' },
})
// Fallback for unknown use case (callers should compute lazily, not at module load):
//   MODEL_SUGGESTIONS[useCase] ?? { quality: resolveDefaultModel(), fast: 'veo-3.1-fast-generate-001' }

export type Region = 'us' | 'eu' | 'uk' | 'ch' | 'mena' | 'other'

const REGION_VALUES: ReadonlySet<string> = new Set<Region>([
  'us', 'eu', 'uk', 'ch', 'mena', 'other',
])

type RegionEntry =
  | { type: 'exact';  location: string; region: Region }
  | { type: 'prefix'; prefix: string;   region: Region }

export const REGIONS: ReadonlyArray<RegionEntry> = [
  // Exact matches first (must beat europe- prefix below)
  { type: 'exact',  location: 'europe-west2',     region: 'uk'    },
  { type: 'exact',  location: 'europe-west6',     region: 'ch'    },
  // Prefix matches
  { type: 'prefix', prefix:   'us-',              region: 'us'    },
  { type: 'prefix', prefix:   'northamerica-',    region: 'us'    },
  { type: 'prefix', prefix:   'europe-',          region: 'eu'    },
  { type: 'prefix', prefix:   'me-',              region: 'mena'  },
  { type: 'prefix', prefix:   'asia-',            region: 'other' },
  { type: 'prefix', prefix:   'australia-',       region: 'other' },
  { type: 'prefix', prefix:   'southamerica-',    region: 'other' },
]

// Regions where personGeneration=allow_all is not permitted; the validator
// auto-fixes allow_all -> allow_adult for these. Single source of truth so the
// rule does not hardcode the list.
export const RESTRICTED_PERSON_REGIONS = ['eu', 'uk', 'ch', 'mena'] as const

export const MAX_TOKENS = 1024
export const TOKEN_WARNING_THRESHOLD = 900

// resolveDefaultModel — lazy, memoized. Does NOT run at module load so tests can vi.mock first.
let cachedDefault: string | undefined

export function resolveDefaultModel(): string {
  if (cachedDefault !== undefined) return cachedDefault
  for (const id of DEFAULT_MODEL_CHAIN) {
    if (AVAILABLE_MODELS.has(id)) {
      cachedDefault = id
      return id
    }
  }
  throw new Error(
    `None of the models in DEFAULT_MODEL_CHAIN (${[...DEFAULT_MODEL_CHAIN].join(', ')}) ` +
      `are present in AVAILABLE_MODELS (${[...AVAILABLE_MODELS].join(', ')}). ` +
      `Update constants.ts via the maintenance protocol (§6).`
  )
}

export function _resetDefaultModelCacheForTests(): void {
  cachedDefault = undefined
}

export function detectRegion(
  gcpLocation?: string,
  envRegion?: string
): Region | undefined {
  // Only honor envRegion when it is a valid Region. A typo in VEO_REGION must NOT
  // early-return undefined and skip the gcpLocation fallback — fall through instead.
  if (envRegion && REGION_VALUES.has(envRegion)) return envRegion as Region
  if (!gcpLocation) return undefined
  // Exact matches take precedence (REGIONS is ordered: exact entries first)
  for (const entry of REGIONS) {
    if (entry.type === 'exact' && entry.location === gcpLocation) return entry.region
    if (entry.type === 'prefix' && gcpLocation.startsWith(entry.prefix)) return entry.region
  }
  return undefined
}
