# Veo Foundation — Implementation Plan

**For agentic workers**: Execute milestones top-to-bottom. Each task is 2–5 minutes. TDD inside every milestone: write the failing test first, then the minimal implementation, then commit. Do not skip the Milestone Gate — it is the contract between layers. Two hard human gates exist: **M11** (SemVer bump confirmation) and **M13** (paid probe pass sign-off). Stop and ask at both.

**Goal**: Land the Veo Foundation sub-project: a shared TypeScript library at `skills/_shared/veo-core/` providing auth, API, generation orchestration, validation, pricing, types, image helpers, and constants. Refactor the two existing skills (`veo`, `veo-multi-shot`) to consume it. Ship CHANGELOG + SemVer major bump (1.0.0 → 2.0.0).

**Architecture**:
- `skills/_shared/veo-core/` is the single owner of API surface, validation rules, pricing data, model curation.
- Path alias `@veo-core/*` → `skills/_shared/veo-core/*` registered programmatically via `bootstrap.ts` (not `NODE_OPTIONS`); vitest mirrors the same alias in `vitest.config.ts`.
- Vertex AI `predictLongRunning` only (Gemini API out of scope).
- `validateConfig()` never throws — discriminated `ValidationResult` union. `generateVideo()` orchestrates auth → validate → submit → poll → download/skip.
- Validation composition via `createValidator({ baseRules, extraRules })` factory; no global registry.
- `ExecutionContext` (currently `{region?}`) threaded into every rule; rules never read `process.env` directly.

**Tech Stack**:
- TypeScript + ts-node (CommonJS target). Entry script shebang: `#!/usr/bin/env ts-node` (not `npx ts-node` — single-arg form requires ts-node on PATH).
- vitest as the test runner. `npm ci && npm test` in CI on PRs to `main`.
- `google-auth-library` for OAuth (no `gcloud` CLI shell-out).
- `@google-cloud/storage` for `gs://` downloads.
- `tsconfig-paths` for runtime alias resolution.

**Branch strategy**: PR #1 (`feat/veo-foundation-spec`) is still open and stays as a documentation-only track. This implementation lands on a **new branch `feat/veo-foundation-impl` from `main`** (PR #2 with CONTRIBUTING.md was merged into `main` 2026-06-16). Use normal incremental commits — no amend, no force-push.

---

## File Structure

Every file the plan creates or modifies, with one-line responsibility.

### Root infrastructure (M0)
- `package.json` — npm manifest with vitest, ts-node, typescript, @types/node devDeps; google-auth-library, @google-cloud/storage, tsconfig-paths deps; `test` / `test:watch` scripts.
- `package-lock.json` — committed (CI uses `npm ci`).
- `tsconfig.json` — declares `@veo-core/*` path alias.
- `vitest.config.ts` — mirrors the alias under `resolve.alias`.
- `.gitignore` — adds `node_modules/`, `coverage/` (NOT `package-lock.json`).
- `.github/workflows/test.yml` — runs `npm ci && npm test` on PRs against `main`.

### Shared library (M1–M6) — `skills/_shared/veo-core/`
- `bootstrap.ts` — registers tsconfig-paths programmatically; walks up to find `.claude-plugin/plugin.json` marker.
- `types.ts` — `VeoConfig`, `GenerationResult`, `ValidationResult`, `RuleResult`, `ImageInput`, `VertexImage`, `ExecutionContext`, `ValidationRule`. Type-only exports.
- `constants.ts` — `AVAILABLE_MODELS`, `DEFAULT_MODEL_CHAIN`, `MODEL_DURATIONS`, `MODEL_SAMPLE_MAX`, `AUDIO_DEFAULTS`, `DURATION_SUGGESTIONS`, `MODEL_SUGGESTIONS`, `REGIONS`, `MAX_TOKENS`, `TOKEN_WARNING_THRESHOLD`, `resolveDefaultModel()`, `detectRegion()`, `_resetDefaultModelCacheForTests()`.
- `auth.ts` — `getAccessToken(): Promise<string>` via `google-auth-library`.
- `image-helpers.ts` — `validateImage(img)`, `encodeImage(img): VertexImage`, `uploadImageToGcs(localPath, gcsUri)`.
- `pricing.ts` — `estimateCost(config): { usd, breakdown }`; dated-header audit trail comments.
- `api.ts` — `submitGeneration`, `pollOperation`, `downloadFile` (HTTPS + gs://, hardened: redirect cap 10, 30s socket / 15m total, cross-origin Authorization stripping per RFC 6454, atomic write, 1 KB error-body cap). Also exports `buildRequestBody`, `decideRedirect`, and the timeout constants `REQUEST_TIMEOUT_MS` / `SOCKET_IDLE_MS` / `TOTAL_DEADLINE_MS` for unit testing.
- `validation.ts` — `FOUNDATION_RULES` (rules #1–#10), `createValidator({baseRules, extraRules})` factory, `validateConfig = createValidator({ baseRules: FOUNDATION_RULES })` export.
- `generate.ts` — `generateVideo(config: VeoConfig): Promise<GenerationResult>` orchestrator.

### Skill refactors (M7–M8)
- `skills/veo/scripts/veo-generate.ts` — thin CLI entry point importing from `@veo-core/*` and `./cli-utils`.
- `skills/veo/scripts/cli-utils.ts` — pure `parseArgs` / `buildConfig` / `FLAGS` (testable seam).
- `skills/veo/scripts/__tests__/cli-utils.test.ts` (M7).
- `skills/veo-multi-shot/scripts/veo-multi-generate.ts` — thin CLI entry point.
- `skills/veo-multi-shot/scripts/multi-cli-utils.ts` — pure `loadStoryboard` / `runDryRun` (testable seam).
- `skills/veo-multi-shot/scripts/__tests__/multi-cli-utils.test.ts` (M8).

### Documentation (M9–M10)
- `skills/veo/SKILL.md` — Phase 1 USE CASE enum extended to 7 values + deterministic audio derivation; new params section (every cross-cutting flag with an example); audio context-aware logic; new model decision table; rewritten Phase 2 CRAFT (6-element formula + negativePrompt auto-suggest), Phase 3 VALIDATE (softened rules + validateConfig), Phase 4 PRESENT (cost from estimateCost), Phase 5 GENERATE (enriched errors), Phase 6 ITERATE (new diagnostic rows).
- `skills/veo/validation/prompt-checklist.md` — soften obsolete rules.
- `skills/veo/references/audio-lexicon.md` — NEW file.
- `skills/veo/examples/` — add audio prompt examples.

### Release artifacts (M11–M12)
- `CHANGELOG.md` — Keep-a-Changelog format; documents the two incompatible changes.
- `.claude-plugin/plugin.json` — version 1.0.0 → 2.0.0 (gated by M11 human confirmation).

### Tests — `skills/_shared/veo-core/__tests__/`
- `alias-sanity.test.ts` (M0; retired in M1 Task 1.1 once the real type surface lands)
- `constants.test.ts` (M1)
- `audio-default.test.ts` (M1; covers AUDIO_DEFAULTS + DURATION_SUGGESTIONS)
- `model-routing.test.ts` (M1)
- `auth.test.ts` (M2; google-auth-library mocked)
- `image-helpers.test.ts` (M2; validateImage + encodeImage, no async GCS)
- `upload-image.test.ts` (M2; uploadImageToGcs with @google-cloud/storage mocked)
- `pricing.test.ts` (M3)
- `api.test.ts` (M4)
- `api-redirect-security.test.ts` (M4; cross-origin auth strip + HTTPS→HTTP reject + socket-idle timeout + timeout-constant wiring)
- `api-request.test.ts` (M4; submitGeneration + pollOperation + buildRequestBody passthrough)
- `validation.test.ts` (M5)
- `auto-fix.test.ts` (M5)
- `generate.test.ts` (M6, with mocked api/auth)

### Release ops (M13–M14)
- `docs/foundation-release-checklist.md` — 9 paid + 1 no-cost manual integration checklist items (10 line items total — items 1, 2, 3, 4, 5, 6, 7, 8a, 9 are paid; 8b is no-cost), executed once before merge.
- PR description on PR #3 — embeds the checklist with checkmarks + links.

---

## M0 — Root infrastructure

**Goal**: Land package.json, lockfile, tsconfig, vitest config, CI, gitignore, bootstrap.ts. Prove the `@veo-core/*` alias works end-to-end before any other code lands.

**Dependencies**: none.

**Gate**: `npm ci && npm test` passes locally and in CI. The single test file imports `@veo-core/types` via the alias and asserts a trivial property.

### Task 0.1 — Branch from main

```bash
cd /home/giuseppe/claude/veo-tools
git fetch origin
git checkout -b feat/veo-foundation-impl origin/main
```

### Task 0.2 — Write `package.json`

`/home/giuseppe/claude/veo-tools/package.json`:

```json
{
  "name": "veo-tools",
  "version": "1.0.0",
  "private": true,
  "description": "Veo video generation skills — shared library + skills.",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@google-cloud/storage": "^7.14.0",
    "google-auth-library": "^9.15.0",
    "tsconfig-paths": "^4.2.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

```bash
git add package.json
git commit -m "feat(M0): add root package.json with vitest + ts-node + google deps"
```

### Task 0.3 — Generate lockfile

```bash
cd /home/giuseppe/claude/veo-tools
npm install
git add package-lock.json
git commit -m "feat(M0): commit package-lock.json (required for npm ci in CI)"
```

### Task 0.4 — Write `tsconfig.json`

`/home/giuseppe/claude/veo-tools/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "noImplicitAny": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": false,
    "baseUrl": ".",
    "paths": {
      "@veo-core/*": ["skills/_shared/veo-core/*"]
    }
  },
  "include": [
    "skills/**/*.ts"
  ],
  "exclude": [
    "node_modules",
    "coverage"
  ]
}
```

```bash
git add tsconfig.json
git commit -m "feat(M0): add tsconfig.json with @veo-core/* path alias"
```

### Task 0.5 — Write `vitest.config.ts`

`/home/giuseppe/claude/veo-tools/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@veo-core': path.resolve(__dirname, 'skills/_shared/veo-core'),
    },
  },
  test: {
    include: ['skills/**/__tests__/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
})
```

```bash
git add vitest.config.ts
git commit -m "feat(M0): add vitest.config.ts mirroring @veo-core alias"
```

### Task 0.6 — Update `.gitignore`

`/home/giuseppe/claude/veo-tools/.gitignore` — append (do NOT add `package-lock.json`):

```
node_modules/
coverage/
*.tmp
```

```bash
git add .gitignore
git commit -m "feat(M0): ignore node_modules/ and coverage/"
```

### Task 0.7 — Write `bootstrap.ts`

`/home/giuseppe/claude/veo-tools/skills/_shared/veo-core/bootstrap.ts`:

```ts
// bootstrap.ts — registers tsconfig-paths programmatically.
// Entry scripts MUST require() this before any @veo-core/* import.
import * as fs from 'node:fs'
import * as path from 'node:path'
import { register } from 'tsconfig-paths'

function findRepoRoot(start: string): string {
  let dir = start
  // Walk upward looking for the .claude-plugin/plugin.json marker.
  // Guards against landing in /tmp or in node_modules during weird invocations.
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, '.claude-plugin', 'plugin.json'))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(
    `bootstrap.ts: could not locate repo root (no .claude-plugin/plugin.json found above ${start})`
  )
}

const REPO_ROOT = findRepoRoot(__dirname)

register({
  baseUrl: REPO_ROOT,
  paths: {
    '@veo-core/*': ['skills/_shared/veo-core/*'],
  },
})

export { REPO_ROOT }
```

```bash
mkdir -p skills/_shared/veo-core
git add skills/_shared/veo-core/bootstrap.ts
git commit -m "feat(M0/bootstrap): register tsconfig-paths programmatically with repo-root walk"
```

### Task 0.8 — Failing alias-sanity test

`/home/giuseppe/claude/veo-tools/skills/_shared/veo-core/__tests__/alias-sanity.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ALIAS_MARKER } from '@veo-core/types'

describe('@veo-core/* alias resolution', () => {
  it('imports a value via the alias', () => {
    expect(ALIAS_MARKER).toBe('veo-core')
  })
})
```

Run it (expect: red — types.ts does not exist yet):

```bash
npm test
```

Expected: `Cannot find module '@veo-core/types'`.

```bash
mkdir -p skills/_shared/veo-core/__tests__
git add skills/_shared/veo-core/__tests__/alias-sanity.test.ts
git commit -m "test(M0): failing alias-sanity test for @veo-core/* path resolution"
```

### Task 0.9 — Minimal types.ts to make the test green

`/home/giuseppe/claude/veo-tools/skills/_shared/veo-core/types.ts`:

```ts
// types.ts — type-only exports for the Veo Foundation surface.
// Runtime marker below is used only by alias-sanity.test.ts and is removed
// in M1 when the real type surface lands.
export const ALIAS_MARKER = 'veo-core' as const
```

Run `npm test` — expect green.

```bash
git add skills/_shared/veo-core/types.ts
git commit -m "feat(M0): minimal types.ts to make alias-sanity green"
```

### Task 0.10 — CI workflow

`/home/giuseppe/claude/veo-tools/.github/workflows/test.yml`:

```yaml
name: test
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm test
```

```bash
mkdir -p .github/workflows
git add .github/workflows/test.yml
git commit -m "ci(M0): add unit-test workflow (npm ci && npm test) on PRs to main"
```

### Milestone Gate M0

```bash
cd /home/giuseppe/claude/veo-tools
npm ci
npm test
```

Expected output (vitest summary):

```
 ✓ skills/_shared/veo-core/__tests__/alias-sanity.test.ts (1)

 Test Files  1 passed (1)
      Tests  1 passed (1)
```

Push and open a draft PR early so CI runs:

```bash
git push -u origin feat/veo-foundation-impl
gh pr create --draft --base main --title "feat: Veo Foundation implementation" --body "WIP. Spec: PR #1. Tracking plan: docs/superpowers/plans/2026-06-16-veo-foundation-impl.md."
```

---

## M1 — `types.ts` + `constants.ts`

**Goal**: Ship the full type surface and the frozen lookup tables (plus `resolveDefaultModel()` and `detectRegion()`). Everything downstream depends on this.

**Dependencies**: M0.

**Gate**: `constants.test.ts`, `audio-default.test.ts`, `model-routing.test.ts` all green. `alias-sanity.test.ts` is retired (replaced by the real type surface).

### Task 1.1 — Replace `types.ts` with the full surface

`/home/giuseppe/claude/veo-tools/skills/_shared/veo-core/types.ts`:

```ts
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
```

Task 1.1 ships a pure type surface — there is no runtime to assert on directly. The implicit assertion is structural: downstream tests (`constants.test.ts` in 1.2 imports `VeoConfig` indirectly; M4–M6 will fail to compile if the shape drifts). We therefore delete the alias-sanity test in the same commit — the type surface itself is now the proof the alias works:

```bash
rm skills/_shared/veo-core/__tests__/alias-sanity.test.ts
git add skills/_shared/veo-core/types.ts skills/_shared/veo-core/__tests__/alias-sanity.test.ts
git commit -m "feat(M1/types): full VeoConfig + GenerationResult + ValidationResult + ImageInput + VertexImage + ExecutionContext"
```

### Task 1.2 — Failing `constants.test.ts`

`/home/giuseppe/claude/veo-tools/skills/_shared/veo-core/__tests__/constants.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL_CHAIN,
  MODEL_DURATIONS,
  MODEL_SAMPLE_MAX,
  REGIONS,
  MAX_TOKENS,
  TOKEN_WARNING_THRESHOLD,
  resolveDefaultModel,
  detectRegion,
  _resetDefaultModelCacheForTests,
} from '@veo-core/constants'

describe('AVAILABLE_MODELS', () => {
  it('contains exactly the 6 pinned IDs', () => {
    expect([...AVAILABLE_MODELS].sort()).toEqual(
      [
        'veo-2.0-generate-001',
        'veo-3.0-fast-generate-001',
        'veo-3.0-generate-001',
        'veo-3.1-fast-generate-001',
        'veo-3.1-generate-001',
        'veo-3.1-lite-generate-001',
      ].sort()
    )
  })
})

describe('DEFAULT_MODEL_CHAIN', () => {
  it('is veo-3.1-generate-001 then veo-3.1-fast-generate-001', () => {
    expect(DEFAULT_MODEL_CHAIN).toEqual([
      'veo-3.1-generate-001',
      'veo-3.1-fast-generate-001',
    ])
  })
})

describe('MODEL_DURATIONS', () => {
  it('Veo 3.x => {4,6,8}', () => {
    for (const m of [
      'veo-3.1-generate-001',
      'veo-3.1-fast-generate-001',
      'veo-3.1-lite-generate-001',
      'veo-3.0-generate-001',
      'veo-3.0-fast-generate-001',
    ]) {
      expect([...MODEL_DURATIONS.get(m)!].sort()).toEqual([4, 6, 8])
    }
  })
  it('Veo 2 => {5,6,8} (7 is NOT accepted)', () => {
    expect([...MODEL_DURATIONS.get('veo-2.0-generate-001')!].sort()).toEqual([5, 6, 8])
  })
  it('unknown model => undefined', () => {
    expect(MODEL_DURATIONS.get('veo-9.9-nonexistent')).toBeUndefined()
  })
})

describe('MODEL_SAMPLE_MAX', () => {
  it('Veo 3.x GA = 4, Veo 2 = 2, Lite PROVISIONAL = 4', () => {
    expect(MODEL_SAMPLE_MAX['veo-3.1-generate-001']).toBe(4)
    expect(MODEL_SAMPLE_MAX['veo-3.1-fast-generate-001']).toBe(4)
    expect(MODEL_SAMPLE_MAX['veo-3.1-lite-generate-001']).toBe(4)
    expect(MODEL_SAMPLE_MAX['veo-3.0-generate-001']).toBe(4)
    expect(MODEL_SAMPLE_MAX['veo-3.0-fast-generate-001']).toBe(4)
    expect(MODEL_SAMPLE_MAX['veo-2.0-generate-001']).toBe(2)
  })
})

describe('MAX_TOKENS / TOKEN_WARNING_THRESHOLD', () => {
  it('1024 / 900', () => {
    expect(MAX_TOKENS).toBe(1024)
    expect(TOKEN_WARNING_THRESHOLD).toBe(900)
  })
})

describe('resolveDefaultModel', () => {
  beforeEach(() => _resetDefaultModelCacheForTests())
  it('returns veo-3.1-generate-001 on first call', () => {
    expect(resolveDefaultModel()).toBe('veo-3.1-generate-001')
  })
  it('memoizes', () => {
    const a = resolveDefaultModel()
    const b = resolveDefaultModel()
    expect(a).toBe(b)
  })
})

describe('detectRegion', () => {
  it('envRegion wins over gcpLocation', () => {
    expect(detectRegion('europe-west2', 'us')).toBe('us')
  })
  it('exact match europe-west2 => uk (beats europe- prefix)', () => {
    expect(detectRegion('europe-west2')).toBe('uk')
  })
  it('exact match europe-west6 => ch', () => {
    expect(detectRegion('europe-west6')).toBe('ch')
  })
  it('prefix europe- => eu', () => {
    expect(detectRegion('europe-west1')).toBe('eu')
  })
  it('prefix us- => us', () => {
    expect(detectRegion('us-central1')).toBe('us')
  })
  it('prefix northamerica- => us', () => {
    expect(detectRegion('northamerica-northeast1')).toBe('us')
  })
  it('prefix me- => mena', () => {
    expect(detectRegion('me-west1')).toBe('mena')
  })
  it('prefix asia- => other', () => {
    expect(detectRegion('asia-east1')).toBe('other')
  })
  it('prefix australia- => other', () => {
    expect(detectRegion('australia-southeast1')).toBe('other')
  })
  it('prefix southamerica- => other', () => {
    expect(detectRegion('southamerica-east1')).toBe('other')
  })
  it('no gcpLocation and no envRegion => undefined', () => {
    expect(detectRegion()).toBeUndefined()
  })
  it('unknown region => undefined', () => {
    expect(detectRegion('africa-mars1')).toBeUndefined()
  })
})

describe('REGIONS ordering invariant', () => {
  it('exact entries come before prefix entries', () => {
    const firstPrefixIdx = REGIONS.findIndex((e) => e.type === 'prefix')
    const lastExactIdx = (() => {
      let i = -1
      REGIONS.forEach((e, idx) => { if (e.type === 'exact') i = idx })
      return i
    })()
    expect(lastExactIdx).toBeLessThan(firstPrefixIdx)
  })
})
```

Run `npm test` — expect red: `Cannot find module '@veo-core/constants'` (constants.ts does not exist yet).

```bash
git add skills/_shared/veo-core/__tests__/constants.test.ts
git commit -m "test(M1/constants): failing tests for AVAILABLE_MODELS / MODEL_DURATIONS / detectRegion ordering"
```

### Task 1.2b — Failing `audio-default.test.ts`

`/home/giuseppe/claude/veo-tools/skills/_shared/veo-core/__tests__/audio-default.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { AUDIO_DEFAULTS, DURATION_SUGGESTIONS } from '@veo-core/constants'

describe('AUDIO_DEFAULTS', () => {
  const expected: Array<[string, boolean]> = [
    ['hero-background', false],
    ['ambient', false],
    ['loop', false],
    ['social', true],
    ['marketing', true],
    ['product', true],
    ['storytelling', true],
  ]
  for (const [useCase, want] of expected) {
    it(`${useCase} => ${want}`, () => {
      expect(AUDIO_DEFAULTS[useCase]).toBe(want)
    })
  }
  it('unspecified use case falls through to true', () => {
    expect(AUDIO_DEFAULTS['nonexistent'] ?? true).toBe(true)
  })
})

describe('DURATION_SUGGESTIONS', () => {
  const expected: Array<[string, number]> = [
    ['hero-background', 4],
    ['ambient', 4],
    ['loop', 4],
    ['social', 8],
    ['marketing', 8],
    ['product', 8],
    ['storytelling', 8],
  ]
  for (const [useCase, want] of expected) {
    it(`${useCase} => ${want}`, () => {
      expect(DURATION_SUGGESTIONS[useCase]).toBe(want)
    })
  }
})
```

Run `npm test` — expect red: `Cannot find name AUDIO_DEFAULTS` / `Cannot find module '@veo-core/constants'` (constants.ts still does not exist; this test must precede the M1 implementation in Task 1.3).

```bash
git add skills/_shared/veo-core/__tests__/audio-default.test.ts
git commit -m "test(M1): failing AUDIO_DEFAULTS + DURATION_SUGGESTIONS table assertions"
```

### Task 1.2c — Failing `model-routing.test.ts`

`/home/giuseppe/claude/veo-tools/skills/_shared/veo-core/__tests__/model-routing.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { MODEL_SUGGESTIONS, resolveDefaultModel, _resetDefaultModelCacheForTests } from '@veo-core/constants'

describe('MODEL_SUGGESTIONS', () => {
  it('all quality entries route to veo-3.1-generate-001 (no deprecated 3.0)', () => {
    for (const v of Object.values(MODEL_SUGGESTIONS)) {
      expect(v.quality).toBe('veo-3.1-generate-001')
    }
  })
  it('hero-background/ambient/loop include a lite entry', () => {
    expect(MODEL_SUGGESTIONS['hero-background'].lite).toBe('veo-3.1-lite-generate-001')
    expect(MODEL_SUGGESTIONS['ambient'].lite).toBe('veo-3.1-lite-generate-001')
    expect(MODEL_SUGGESTIONS['loop'].lite).toBe('veo-3.1-lite-generate-001')
  })
  it('social/marketing/product/storytelling omit lite', () => {
    expect(MODEL_SUGGESTIONS['social'].lite).toBeUndefined()
    expect(MODEL_SUGGESTIONS['marketing'].lite).toBeUndefined()
    expect(MODEL_SUGGESTIONS['product'].lite).toBeUndefined()
    expect(MODEL_SUGGESTIONS['storytelling'].lite).toBeUndefined()
  })
  it('unknown use case fallback has no lite', () => {
    _resetDefaultModelCacheForTests()
    const fallback = MODEL_SUGGESTIONS['nonexistent'] ?? {
      quality: resolveDefaultModel(),
      fast: 'veo-3.1-fast-generate-001',
    }
    expect(fallback.quality).toBe('veo-3.1-generate-001')
    expect(fallback.fast).toBe('veo-3.1-fast-generate-001')
    expect((fallback as { lite?: string }).lite).toBeUndefined()
  })
})
```

Run `npm test` — expect red: `Cannot find module '@veo-core/constants'` (still missing).

```bash
git add skills/_shared/veo-core/__tests__/model-routing.test.ts
git commit -m "test(M1): failing MODEL_SUGGESTIONS table-hit + fallback (no lite)"
```

### Task 1.3 — Implement `constants.ts`

`/home/giuseppe/claude/veo-tools/skills/_shared/veo-core/constants.ts`:

```ts
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
  'veo-3.1-lite-generate-001': 4, // PROVISIONAL — Preview tier; verify in probe pass (M13)
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

type RegionEntry =
  | { type: 'exact';  location: string; region: 'us' | 'eu' | 'uk' | 'ch' | 'mena' | 'other' }
  | { type: 'prefix'; prefix: string;   region: 'us' | 'eu' | 'uk' | 'ch' | 'mena' | 'other' }

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
): 'us' | 'eu' | 'uk' | 'ch' | 'mena' | 'other' | undefined {
  if (envRegion) return envRegion as 'us' | 'eu' | 'uk' | 'ch' | 'mena' | 'other'
  if (!gcpLocation) return undefined
  // Exact matches take precedence (REGIONS is ordered: exact entries first)
  for (const entry of REGIONS) {
    if (entry.type === 'exact' && entry.location === gcpLocation) return entry.region
    if (entry.type === 'prefix' && gcpLocation.startsWith(entry.prefix)) return entry.region
  }
  return undefined
}
```

Run `npm test` — expect green for all three M1 test files (`constants.test.ts`, `audio-default.test.ts`, `model-routing.test.ts`). Constants.ts is the single source that turns Tasks 1.2, 1.2b, and 1.2c green simultaneously.

```bash
git add skills/_shared/veo-core/constants.ts
git commit -m "feat(M1/constants): AVAILABLE_MODELS + MODEL_DURATIONS + AUDIO_DEFAULTS + MODEL_SUGGESTIONS + region tables + resolveDefaultModel/detectRegion"
```

### Milestone Gate M1

```bash
npm test -- --reporter=verbose constants audio-default model-routing
```

Expected: 3 test files, all green. No failures.

---

## M2 — `auth.ts` + `image-helpers.ts`

**Goal**: Leaf modules with no veo-core internal dependencies (other than `types.ts`).

**Dependencies**: M1.

**Gate**: `image-helpers.test.ts` green; `auth.test.ts` green (with `google-auth-library` mocked); end-to-end manual auth integration with real GCP credentials still happens in M13.

### Task 2.0 — Failing `auth.test.ts`

`/home/giuseppe/claude/veo-tools/skills/_shared/veo-core/__tests__/auth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getClientMock = vi.fn()
const getAccessTokenMock = vi.fn()
const GoogleAuthMock = vi.fn(function () {
  return { getClient: () => getClientMock() }
})

vi.mock('google-auth-library', () => ({
  GoogleAuth: GoogleAuthMock,
}))

beforeEach(() => {
  vi.resetModules()
  GoogleAuthMock.mockClear()
  getClientMock.mockReset()
  getAccessTokenMock.mockReset()
  getClientMock.mockResolvedValue({ getAccessToken: () => getAccessTokenMock() })
})

describe('getAccessToken', () => {
  it('returns the token issued by the underlying client', async () => {
    getAccessTokenMock.mockResolvedValue({ token: 'abc-123' })
    const { getAccessToken } = await import('@veo-core/auth')
    await expect(getAccessToken()).resolves.toBe('abc-123')
  })

  it('throws a guidance message when the client returns no token', async () => {
    getAccessTokenMock.mockResolvedValue({ token: undefined })
    const { getAccessToken } = await import('@veo-core/auth')
    await expect(getAccessToken()).rejects.toThrow(/no access token/i)
  })

  it('constructs GoogleAuth with the cloud-platform scope', async () => {
    getAccessTokenMock.mockResolvedValue({ token: 'ok' })
    const { getAccessToken } = await import('@veo-core/auth')
    await getAccessToken()
    expect(GoogleAuthMock).toHaveBeenCalledTimes(1)
    const ctorArg = GoogleAuthMock.mock.calls[0]?.[0] as { scopes?: string[] }
    expect(ctorArg?.scopes).toEqual(['https://www.googleapis.com/auth/cloud-platform'])
  })
})
```

Run `npm test` — expect red: `Cannot find module '@veo-core/auth'` (auth.ts does not exist yet).

```bash
git add skills/_shared/veo-core/__tests__/auth.test.ts
git commit -m "test(M2/auth): failing getAccessToken assertions (token success, missing-token throw, scope wiring)"
```

### Task 2.1 — `auth.ts`

Implement the module that turns Task 2.0's failing test green.

`/home/giuseppe/claude/veo-tools/skills/_shared/veo-core/auth.ts`:

```ts
// auth.ts — OAuth token issuance via google-auth-library.
// Supports Service Accounts, ADC, Workload Identity natively (no gcloud CLI shell-out).
import { GoogleAuth } from 'google-auth-library'

const SCOPES = ['https://www.googleapis.com/auth/cloud-platform']

let cachedAuth: GoogleAuth | undefined

export async function getAccessToken(): Promise<string> {
  if (!cachedAuth) cachedAuth = new GoogleAuth({ scopes: SCOPES })
  const client = await cachedAuth.getClient()
  const tokenResponse = await client.getAccessToken()
  if (!tokenResponse.token) {
    throw new Error('google-auth-library returned no access token. Check GOOGLE_APPLICATION_CREDENTIALS / ADC.')
  }
  return tokenResponse.token
}
```

Run `npm test` — expect green (Task 2.0's three assertions now pass).

```bash
git add skills/_shared/veo-core/auth.ts
git commit -m "feat(M2/auth): getAccessToken via google-auth-library (replaces gcloud CLI shell-out)"
```

### Task 2.2 — Failing `image-helpers.test.ts`

`/home/giuseppe/claude/veo-tools/skills/_shared/veo-core/__tests__/image-helpers.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { validateImage, encodeImage } from '@veo-core/image-helpers'

let tmpDir: string
let jpgPath: string
let pngPath: string
let webpPath: string

// 1x1 PNG bytes (well-known minimal file)
const PNG_1x1 = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C6300010000000500010D0A2DB40000000049454E44AE426082',
  'hex'
)
// 1x1 JPEG bytes (minimal)
const JPG_1x1 = Buffer.from(
  'FFD8FFE000104A46494600010100000100010000FFDB004300080606070605080707070909080A0C140D0C0B0B0C1912130F141D1A1F1E1D1A1C1C20242E2720222C231C1C2837292C30313434341F27393D38323C2E333432FFC0000B0801000100012200FFC4001F0000010501010101010100000000000000000102030405060708090A0BFFC400B5100002010303020403050504040000017D01020300041105122131410613516107227114328191A1082342B1C11552D1F02433627282090A161718191A25262728292A3435363738393A434445464748494A535455565758595A636465666768696A737475767778797A838485868788898A92939495969798999AA2A3A4A5A6A7A8A9AAB2B3B4B5B6B7B8B9BAC2C3C4C5C6C7C8C9CAD2D3D4D5D6D7D8D9DAE1E2E3E4E5E6E7E8E9EAF1F2F3F4F5F6F7F8F9FAFFDA0008010100003F00FBD0FFD9',
  'hex'
)
// Minimal WebP file header
const WEBP_1x1 = Buffer.from(
  '52494646260000005745425056503820180000003001009D012A0100010000C0061000B025A4006F008800000000000000',
  'hex'
)

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veo-img-test-'))
  jpgPath = path.join(tmpDir, 'a.jpg')
  pngPath = path.join(tmpDir, 'b.png')
  webpPath = path.join(tmpDir, 'c.webp')
  fs.writeFileSync(jpgPath, JPG_1x1)
  fs.writeFileSync(pngPath, PNG_1x1)
  fs.writeFileSync(webpPath, WEBP_1x1)
})
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

describe('validateImage (synchronous; no GCS API calls)', () => {
  it('accepts a local jpg', () => {
    expect(() => validateImage({ path: jpgPath })).not.toThrow()
  })
  it('accepts a local png', () => {
    expect(() => validateImage({ path: pngPath })).not.toThrow()
  })
  it('accepts a local webp', () => {
    expect(() => validateImage({ path: webpPath })).not.toThrow()
  })
  it('rejects a missing local file', () => {
    expect(() => validateImage({ path: '/nonexistent/file.jpg' })).toThrow(/not found|exist/i)
  })
  it('rejects malformed gs:// — empty bucket', () => {
    expect(() => validateImage({ gcsUri: 'gs:///object' })).toThrow(/gs:\/\//i)
  })
  it('rejects malformed gs:// — missing object', () => {
    expect(() => validateImage({ gcsUri: 'gs://bucket' })).toThrow(/gs:\/\//i)
  })
  it('rejects wrong scheme', () => {
    expect(() => validateImage({ gcsUri: 's3://bucket/object' })).toThrow(/gs:\/\//i)
  })
  it('accepts well-formed gs://', () => {
    expect(() => validateImage({ gcsUri: 'gs://bucket/path/object.jpg' })).not.toThrow()
  })
})

describe('encodeImage', () => {
  it('path => bytesBase64Encoded variant with sniffed mimeType', () => {
    const out = encodeImage({ path: jpgPath })
    expect('bytesBase64Encoded' in out).toBe(true)
    if ('bytesBase64Encoded' in out) {
      expect(out.mimeType).toBe('image/jpeg')
      expect(Buffer.from(out.bytesBase64Encoded, 'base64').equals(JPG_1x1)).toBe(true)
    }
  })
  it('buffer => bytesBase64Encoded variant with explicit mimeType', () => {
    const out = encodeImage({ buffer: PNG_1x1, mimeType: 'image/png' })
    expect('bytesBase64Encoded' in out).toBe(true)
    if ('bytesBase64Encoded' in out) {
      expect(out.mimeType).toBe('image/png')
      expect(Buffer.from(out.bytesBase64Encoded, 'base64').equals(PNG_1x1)).toBe(true)
    }
  })
  it('gcsUri => gcsUri pass-through variant', () => {
    const out = encodeImage({ gcsUri: 'gs://bucket/obj.jpg' })
    expect('gcsUri' in out).toBe(true)
    if ('gcsUri' in out) expect(out.gcsUri).toBe('gs://bucket/obj.jpg')
  })
})
```

```bash
git add skills/_shared/veo-core/__tests__/image-helpers.test.ts
git commit -m "test(M2/image-helpers): MIME sniff + base64 + gs:// shape validation (no async GCS)"
```

### Task 2.2b — Failing `upload-image.test.ts` (uploadImageToGcs)

`uploadImageToGcs(localPath, gcsUri)` is an explicitly-scoped public function (spec §Scope + Module boundaries) that the synchronous `image-helpers.test.ts` never touches. Cover it in a dedicated file because it needs `@google-cloud/storage` mocked (the sync tests must stay mock-free). Assert it parses the `gs://` URI, calls `Storage().bucket(bucket).upload(localPath, {destination: object})`, returns the original `gcsUri`, and throws on a malformed URI before any client call.

`/home/giuseppe/claude/veo-tools/skills/_shared/veo-core/__tests__/upload-image.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const uploadMock = vi.fn(async () => undefined)
const bucketMock = vi.fn(() => ({ upload: uploadMock }))
const StorageMock = vi.fn(function () {
  return { bucket: bucketMock }
})

vi.mock('@google-cloud/storage', () => ({ Storage: StorageMock }))

beforeEach(() => {
  StorageMock.mockClear()
  bucketMock.mockClear()
  uploadMock.mockClear()
})

describe('uploadImageToGcs', () => {
  it('parses bucket/object, calls upload with destination=object, returns the gcsUri', async () => {
    const { uploadImageToGcs } = await import('@veo-core/image-helpers')
    const result = await uploadImageToGcs('/local/x.jpg', 'gs://my-bucket/path/o.jpg')
    expect(result).toBe('gs://my-bucket/path/o.jpg')
    expect(bucketMock).toHaveBeenCalledWith('my-bucket')
    expect(uploadMock).toHaveBeenCalledWith('/local/x.jpg', { destination: 'path/o.jpg' })
  })

  it('throws on a malformed gs:// URI (no object) before any Storage call', async () => {
    const { uploadImageToGcs } = await import('@veo-core/image-helpers')
    await expect(uploadImageToGcs('/local/x.jpg', 'gs://bucket-only')).rejects.toThrow(/gs:\/\/|empty object/i)
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('throws on a non-gs:// scheme before any Storage call', async () => {
    const { uploadImageToGcs } = await import('@veo-core/image-helpers')
    await expect(uploadImageToGcs('/local/x.jpg', 's3://bucket/o.jpg')).rejects.toThrow(/gs:\/\//i)
    expect(uploadMock).not.toHaveBeenCalled()
  })
})
```

Run `npm test` — expect red: `Cannot find module '@veo-core/image-helpers'` (image-helpers.ts does not exist yet; Task 2.3 lands it and turns both Task 2.2 and 2.2b green).

```bash
git add skills/_shared/veo-core/__tests__/upload-image.test.ts
git commit -m "test(M2/image-helpers): uploadImageToGcs parses gs:// + calls bucket().upload() + throws on malformed URI"
```

> **Note for Task 2.3**: `parseGcsUri` must throw *before* constructing `Storage()` so the malformed-URI cases never hit the client — the implementation as written already does this (`parseGcsUri(gcsUri)` runs first). Do not reorder.

### Task 2.3 — Implement `image-helpers.ts`

`/home/giuseppe/claude/veo-tools/skills/_shared/veo-core/image-helpers.ts`:

```ts
// image-helpers.ts — synchronous validation + encoding of ImageInput to VertexImage.
// validateImage does NOT verify GCS object existence (no async API calls).
import * as fs from 'node:fs'
import * as path from 'node:path'
import { Storage } from '@google-cloud/storage'
import type { ImageInput, VertexImage } from '@veo-core/types'

const EXT_TO_MIME: Record<string, string> = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
}

function sniffMime(p: string): string {
  const ext = path.extname(p).toLowerCase()
  const mime = EXT_TO_MIME[ext]
  if (!mime) throw new Error(`Cannot sniff MIME type from extension: ${p}`)
  return mime
}

function parseGcsUri(uri: string): { bucket: string; object: string } {
  if (!uri.startsWith('gs://')) {
    throw new Error(`Image gcsUri must start with gs:// — got: ${uri}`)
  }
  const rest = uri.slice(5)
  const slash = rest.indexOf('/')
  if (slash === -1) throw new Error(`Malformed gs:// URI (no object path): ${uri}`)
  const bucket = rest.slice(0, slash)
  const object = rest.slice(slash + 1)
  if (!bucket) throw new Error(`Malformed gs:// URI (empty bucket): ${uri}`)
  if (!object) throw new Error(`Malformed gs:// URI (empty object): ${uri}`)
  return { bucket, object }
}

export function validateImage(img: ImageInput): void {
  if ('path' in img) {
    if (!fs.existsSync(img.path)) {
      throw new Error(`Image file not found: ${img.path}`)
    }
    if (!img.mimeType) sniffMime(img.path) // throws on unknown ext
    return
  }
  if ('buffer' in img) {
    if (!img.mimeType) throw new Error('Buffer image requires explicit mimeType')
    return
  }
  if ('gcsUri' in img) {
    parseGcsUri(img.gcsUri) // throws on malformed
    return
  }
  throw new Error('Unrecognized ImageInput variant')
}

export function encodeImage(img: ImageInput): VertexImage {
  validateImage(img)
  if ('path' in img) {
    const mimeType = img.mimeType ?? sniffMime(img.path)
    const bytes = fs.readFileSync(img.path)
    return { bytesBase64Encoded: bytes.toString('base64'), mimeType }
  }
  if ('buffer' in img) {
    return { bytesBase64Encoded: img.buffer.toString('base64'), mimeType: img.mimeType }
  }
  // gcsUri variant
  return { gcsUri: img.gcsUri, mimeType: img.mimeType }
}

export async function uploadImageToGcs(localPath: string, gcsUri: string): Promise<string> {
  const { bucket, object } = parseGcsUri(gcsUri)
  const storage = new Storage()
  await storage.bucket(bucket).upload(localPath, { destination: object })
  return gcsUri
}
```

Run `npm test` — expect green for image-helpers.

```bash
git add skills/_shared/veo-core/image-helpers.ts
git commit -m "feat(M2/image-helpers): validateImage + encodeImage + uploadImageToGcs"
```

### Milestone Gate M2

```bash
npm test -- image-helpers upload-image auth
```

Expected: all assertions green (image-helpers.test.ts + upload-image.test.ts + auth.test.ts). `uploadImageToGcs` is asserted to parse the gs:// URI, call `bucket().upload(localPath, {destination})`, return the gcsUri, and throw on malformed URIs before any Storage call.

---

## M3 — `pricing.ts`

**Goal**: Implement `estimateCost(config)` keyed by `model × resolution × duration × audio × sampleCount` with the file-header audit trail.

**Dependencies**: M1.

**Gate**: `pricing.test.ts` green; file header carries `// Last updated: 2026-06-16`, `// Source: <URL>`, `// REVIEW BEFORE EACH RELEASE`.

**Note on unknown-model behavior**: The spec does not pin this. We choose: **throw** `Error("estimateCost: unknown model '<id>' — add it to pricing.ts or use one of: <AVAILABLE_MODELS>")` so the caller never silently displays $0.00. Document the choice in the file header so reviewers know it deviated from the sibling-constant "return undefined" convention.

### Task 3.1 — Failing `pricing.test.ts`

`/home/giuseppe/claude/veo-tools/skills/_shared/veo-core/__tests__/pricing.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { estimateCost } from '@veo-core/pricing'
import type { VeoConfig } from '@veo-core/types'

const base: VeoConfig = {
  prompt: 'x',
  outputPath: '/tmp/x.mp4',
}

describe('estimateCost — sampleCount strict multiplier', () => {
  it('doubles cost when sampleCount=2', () => {
    const one = estimateCost({ ...base, model: 'veo-3.1-generate-001', resolution: '720p', durationSeconds: 8, generateAudio: false, sampleCount: 1 })
    const two = estimateCost({ ...base, model: 'veo-3.1-generate-001', resolution: '720p', durationSeconds: 8, generateAudio: false, sampleCount: 2 })
    expect(two.usd).toBeCloseTo(one.usd * 2, 5)
  })
})

describe('estimateCost — known models return a positive number with breakdown', () => {
  const models = [
    'veo-3.1-generate-001',
    'veo-3.1-fast-generate-001',
    'veo-3.1-lite-generate-001',
    'veo-3.0-generate-001',
    'veo-3.0-fast-generate-001',
    'veo-2.0-generate-001',
  ]
  for (const model of models) {
    it(`${model} returns usd>0 + non-empty breakdown`, () => {
      const isVeo2 = model.startsWith('veo-2')
      const result = estimateCost({
        ...base,
        model,
        resolution: '720p',
        durationSeconds: isVeo2 ? 8 : 8,
        generateAudio: !isVeo2,
        sampleCount: 1,
      })
      expect(result.usd).toBeGreaterThan(0)
      expect(result.breakdown.length).toBeGreaterThan(0)
    })
  }
})

describe('estimateCost — audio increases cost on Veo 3.x', () => {
  it('audio=true >= audio=false at same resolution/duration', () => {
    const off = estimateCost({ ...base, model: 'veo-3.1-generate-001', resolution: '720p', durationSeconds: 8, generateAudio: false, sampleCount: 1 })
    const on  = estimateCost({ ...base, model: 'veo-3.1-generate-001', resolution: '720p', durationSeconds: 8, generateAudio: true,  sampleCount: 1 })
    expect(on.usd).toBeGreaterThanOrEqual(off.usd)
  })
})

describe('estimateCost — higher resolution >= lower at same duration', () => {
  it('1080p >= 720p', () => {
    const lo = estimateCost({ ...base, model: 'veo-3.1-generate-001', resolution: '720p',  durationSeconds: 8, generateAudio: false, sampleCount: 1 })
    const hi = estimateCost({ ...base, model: 'veo-3.1-generate-001', resolution: '1080p', durationSeconds: 8, generateAudio: false, sampleCount: 1 })
    expect(hi.usd).toBeGreaterThanOrEqual(lo.usd)
  })
})

describe('estimateCost — unknown model throws', () => {
  it('throws with guidance message', () => {
    expect(() =>
      estimateCost({ ...base, model: 'veo-9.9-fake', resolution: '720p', durationSeconds: 8, generateAudio: false, sampleCount: 1 })
    ).toThrow(/unknown model/i)
  })
})
```

Run `npm test` — expect red: `Cannot find module '@veo-core/pricing'` (pricing.ts does not exist yet).

```bash
git add skills/_shared/veo-core/__tests__/pricing.test.ts
git commit -m "test(M3/pricing): full matrix + sampleCount multiplier + unknown-model throws"
```

### Task 3.2 — Implement `pricing.ts`

`/home/giuseppe/claude/veo-tools/skills/_shared/veo-core/pricing.ts`:

```ts
// pricing.ts
// Last updated: 2026-06-16
// Source: https://cloud.google.com/vertex-ai/generative-ai/pricing#veo-models
// REVIEW BEFORE EACH RELEASE
//
// Unknown-model behavior: estimateCost THROWS (deliberate deviation from the
// MODEL_DURATIONS/MODEL_SAMPLE_MAX "return undefined" convention). Rationale:
// callers display the result to the user; silent $0.00 would be misleading.

import type { VeoConfig } from '@veo-core/types'

// Per-second base rates (USD/sec) at 720p without audio, sampleCount=1.
// Resolution multipliers applied below.
// These are illustrative seed values pending oracle review on first paid probe (M13).
const BASE_USD_PER_SEC: Record<string, number> = {
  'veo-3.1-generate-001':      0.50,
  'veo-3.1-fast-generate-001': 0.35,
  'veo-3.1-lite-generate-001': 0.20,
  'veo-3.0-generate-001':      0.50,
  'veo-3.0-fast-generate-001': 0.35,
  'veo-2.0-generate-001':      0.40, // no audio supported
}

const RESOLUTION_MULTIPLIER: Record<string, number> = {
  '720p':  1.00,
  '1080p': 1.50,
  '4k':    3.00,
}

const AUDIO_PER_SEC_DELTA = 0.05 // Veo 3.x only; Veo 2 ignores

export function estimateCost(config: VeoConfig): { usd: number; breakdown: string } {
  const model      = config.model      ?? 'veo-3.1-generate-001'
  const resolution = config.resolution ?? '720p'
  const duration   = config.durationSeconds ?? 8
  const audio      = config.generateAudio === true
  const samples    = config.sampleCount ?? 1

  const base = BASE_USD_PER_SEC[model]
  if (base === undefined) {
    throw new Error(
      `estimateCost: unknown model '${model}' — add it to pricing.ts or use one of: ` +
        Object.keys(BASE_USD_PER_SEC).join(', ')
    )
  }
  const resMult = RESOLUTION_MULTIPLIER[resolution] ?? 1
  const audioDelta = audio && !model.startsWith('veo-2') ? AUDIO_PER_SEC_DELTA : 0

  const perVideo = (base + audioDelta) * resMult * duration
  const usd = perVideo * samples

  const breakdown =
    `${model}, ${duration}s, ${resolution}` +
    (audio ? ', audio' : '') +
    (samples > 1 ? `, x${samples}` : '')

  return { usd: Math.round(usd * 100) / 100, breakdown }
}
```

Run `npm test` — expect green.

```bash
git add skills/_shared/veo-core/pricing.ts
git commit -m "feat(M3/pricing): estimateCost with dated header + unknown-model throw"
```

### Milestone Gate M3

```bash
npm test -- pricing
```

Expected: all green; `unknown model` throw path covered.

---

## M4 — `api.ts`

**Goal**: HTTPS API calls + hardened `downloadFile` covering both `https://` and `gs://`, with redirect cap 10, dual timeouts, cross-origin Authorization stripping (RFC 6454), HTTPS→HTTP rejection, atomic temp-file write, 1 KB error-body cap.

**Dependencies**: M1, M2.

**Gate**: `api.test.ts` + `api-redirect-security.test.ts` + `api-request.test.ts` all green. Covers redirect/timeout/atomic-write paths, cross-origin Authorization stripping (two-server proof the bearer token does not cross origins), HTTPS→HTTP rejection, socket-idle timeout, and submitGeneration/pollOperation/buildRequestBody parameter passthrough.

### Task 4.1 — Failing `api.test.ts` (core hardening cases)

`/home/giuseppe/claude/veo-tools/skills/_shared/veo-core/__tests__/api.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as http from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { downloadFile } from '@veo-core/api'

// We exercise the redirect / error-body-cap / atomic-write logic against a local
// http server. HTTPS-specific paths (cross-origin Authorization stripping,
// HTTPS->HTTP rejection) and the socket-idle timeout are covered in the dedicated
// api-redirect-security.test.ts (Task 4.1b); submitGeneration/pollOperation/
// buildRequestBody are covered in api-request.test.ts (Task 4.1c).

let server: http.Server
let port: number
let tmpDir: string

const PAYLOAD = Buffer.alloc(64, 0x41) // 64 bytes of 'A'
const BIG_BODY = Buffer.alloc(64 * 1024, 0x42) // 64 KB

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veo-api-test-'))
  server = http.createServer((req, res) => {
    const url = req.url ?? '/'
    if (url === '/ok') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      res.end(PAYLOAD)
      return
    }
    if (url.startsWith('/redirect-chain/')) {
      const n = parseInt(url.split('/').pop()!, 10)
      if (n <= 0) { res.writeHead(302, { location: '/ok' }); res.end(); return }
      res.writeHead(302, { location: `/redirect-chain/${n - 1}` })
      res.end()
      return
    }
    if (url === '/redirect-loop') {
      res.writeHead(302, { location: '/redirect-loop' })
      res.end()
      return
    }
    if (url === '/err-big') {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end(BIG_BODY)
      return
    }
    res.writeHead(404)
    res.end('not found')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  port = (server.address() as { port: number }).port
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('downloadFile — https branch (using http here for test infra; same code path)', () => {
  it('writes the file atomically (no .tmp left behind on success)', async () => {
    const out = path.join(tmpDir, 'a.bin')
    await downloadFile(`http://127.0.0.1:${port}/ok`, out, 'fake-token')
    expect(fs.readFileSync(out).equals(PAYLOAD)).toBe(true)
    const stranded = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.tmp'))
    expect(stranded.length).toBe(0)
  })

  it('follows redirects up to depth 10', async () => {
    const out = path.join(tmpDir, 'b.bin')
    await downloadFile(`http://127.0.0.1:${port}/redirect-chain/5`, out, 'fake-token')
    expect(fs.readFileSync(out).equals(PAYLOAD)).toBe(true)
  })

  it('rejects when redirect chain exceeds depth 10', async () => {
    const out = path.join(tmpDir, 'c.bin')
    await expect(
      downloadFile(`http://127.0.0.1:${port}/redirect-chain/15`, out, 'fake-token')
    ).rejects.toThrow(/redirect/i)
  })

  it('caps error body at ~1 KB in the thrown message', async () => {
    const out = path.join(tmpDir, 'd.bin')
    let err: Error | undefined
    try {
      await downloadFile(`http://127.0.0.1:${port}/err-big`, out, 'fake-token')
    } catch (e) {
      err = e as Error
    }
    expect(err).toBeDefined()
    expect(err!.message.length).toBeLessThan(2048) // 1KB body + status/url framing
  })

  it('leaves no stranded .tmp on error', async () => {
    const out = path.join(tmpDir, 'e.bin')
    try {
      await downloadFile(`http://127.0.0.1:${port}/err-big`, out, 'fake-token')
    } catch { /* expected */ }
    expect(fs.existsSync(out)).toBe(false)
    const stranded = fs.readdirSync(tmpDir).filter((f) => f.startsWith('e.bin') && f.endsWith('.tmp'))
    expect(stranded.length).toBe(0)
  })
})

describe('downloadFile — URL scheme handling', () => {
  it('rejects unsupported schemes', async () => {
    await expect(
      downloadFile('ftp://example.com/file', path.join(tmpDir, 'f.bin'), 'fake-token')
    ).rejects.toThrow(/scheme|protocol|http|gs:/i)
  })
})
```

Run `npm test` — expect red: `Cannot find module '@veo-core/api'` (api.ts does not exist yet).

```bash
git add skills/_shared/veo-core/__tests__/api.test.ts
git commit -m "test(M4/api): downloadFile atomic write + redirect cap + error-body cap"
```

### Task 4.1b — Failing `api-redirect-security.test.ts` (cross-origin auth strip + HTTPS→HTTP reject + socket-idle timeout)

The header comment in Task 4.1's `api.test.ts` promises these cases "using two servers" but the file never delivers them. This is the highest-value security behavior in scope (Vertex bearer token must not leak to a signed GCS origin) and must be asserted. Put them in a dedicated file so the two-server / TLS infrastructure does not complicate `api.test.ts`.

`/home/giuseppe/claude/veo-tools/skills/_shared/veo-core/__tests__/api-redirect-security.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as http from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { downloadFile } from '@veo-core/api'

const PAYLOAD = Buffer.alloc(32, 0x41)

let tmpDir: string

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veo-api-sec-'))
})
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('downloadFile — cross-origin Authorization stripping (RFC 6454)', () => {
  it('strips Authorization when a redirect crosses to a different origin (host/port)', async () => {
    // Server B (the redirect TARGET) records whatever Authorization header it receives.
    let authSeenOnB: string | undefined = 'UNSET'
    const serverB = http.createServer((req, res) => {
      authSeenOnB = req.headers.authorization
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      res.end(PAYLOAD)
    })
    await new Promise<void>((r) => serverB.listen(0, '127.0.0.1', () => r()))
    const portB = (serverB.address() as { port: number }).port

    // Server A 302-redirects to B (different port => different origin per RFC 6454).
    const serverA = http.createServer((req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${portB}/video.mp4` })
      res.end()
    })
    await new Promise<void>((r) => serverA.listen(0, '127.0.0.1', () => r()))
    const portA = (serverA.address() as { port: number }).port

    try {
      const out = path.join(tmpDir, 'cross.bin')
      await downloadFile(`http://127.0.0.1:${portA}/start`, out, 'secret-bearer-token')
      expect(fs.readFileSync(out).equals(PAYLOAD)).toBe(true)
      // The bearer token must NOT have been forwarded to the different origin.
      expect(authSeenOnB).toBeUndefined()
    } finally {
      await new Promise<void>((r) => serverA.close(() => r()))
      await new Promise<void>((r) => serverB.close(() => r()))
    }
  })

  it('keeps Authorization on a same-origin redirect (sanity: stripping is origin-scoped, not blanket)', async () => {
    let authSeen: string | undefined = 'UNSET'
    const server = http.createServer((req, res) => {
      if (req.url === '/start') {
        // Redirect to a different PATH on the SAME origin.
        res.writeHead(302, { location: '/video.mp4' })
        res.end()
        return
      }
      authSeen = req.headers.authorization
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      res.end(PAYLOAD)
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as { port: number }).port
    try {
      const out = path.join(tmpDir, 'same.bin')
      await downloadFile(`http://127.0.0.1:${port}/start`, out, 'secret-bearer-token')
      expect(authSeen).toBe('Bearer secret-bearer-token')
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
    }
  })
})

describe('downloadFile — HTTPS→HTTP redirect is rejected outright', () => {
  // A real TLS server would force the test to either disable TLS verification
  // (NODE_TLS_REJECT_UNAUTHORIZED=0 — forbidden: enables MITM) or inject a trusted
  // CA, neither of which is hermetic in CI. The behavior under test is purely the
  // redirect-decision branch, so Task 4.2 exposes it as a pure, side-effect-free
  // export `decideRedirect(currentUrl, location)` that downloadFromHttps calls. We
  // unit-test that branch directly — no sockets, no cert handling, no TLS bypass.
  it('rejects an https:// -> http:// downgrade', async () => {
    const { decideRedirect } = await import('@veo-core/api')
    expect(() =>
      decideRedirect(new URL('https://host-a.example/v.mp4'), 'http://host-b.example/v.mp4')
    ).toThrow(/HTTPS.*HTTP|cleartext/i)
  })
  it('allows https:// -> https:// and reports cross-origin so Authorization is stripped', async () => {
    const { decideRedirect } = await import('@veo-core/api')
    const d = decideRedirect(new URL('https://host-a.example/v.mp4'), 'https://host-b.example/v.mp4')
    expect(d.nextUrl.host).toBe('host-b.example')
    expect(d.crossOrigin).toBe(true)
  })
  it('allows https:// -> https:// same origin and reports same-origin', async () => {
    const { decideRedirect } = await import('@veo-core/api')
    const d = decideRedirect(new URL('https://host-a.example/v.mp4'), 'https://host-a.example/other.mp4')
    expect(d.crossOrigin).toBe(false)
  })
})

describe('downloadFile — socket-idle timeout (belt) and total deadline (suspenders)', () => {
  it('rejects when the socket stalls mid-body past the idle limit', async () => {
    // Write one byte then stall forever. The idle watchdog must fire.
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': '1024' })
      res.write(Buffer.from([0x41])) // one byte, then never finish
      // intentionally do NOT call res.end()
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as { port: number }).port
    try {
      const out = path.join(tmpDir, 'stall.bin')
      await expect(
        downloadFile(`http://127.0.0.1:${port}/slow`, out, 'tok', { socketIdleMs: 200 })
      ).rejects.toThrow(/idle/i)
      expect(fs.existsSync(out)).toBe(false) // no stranded final file
    } finally {
      server.closeAllConnections?.()
      await new Promise<void>((r) => server.close(() => r()))
    }
  }, 10_000)
})

describe('api timeout constants are wired', () => {
  it('exports the three documented timeout constants', async () => {
    const api = await import('@veo-core/api')
    expect(api.REQUEST_TIMEOUT_MS).toBe(30_000)
    expect(api.SOCKET_IDLE_MS).toBe(30_000)
    expect(api.TOTAL_DEADLINE_MS).toBe(15 * 60 * 1000)
  })
})
```

Run `npm test` — expect red: `Cannot find module '@veo-core/api'` plus, once 4.2 lands the module, the `socketIdleMs` opts param, the exported `decideRedirect`, and the three exported constants must exist (Task 4.2 is updated below to export them and to accept the optional `opts`).

```bash
git add skills/_shared/veo-core/__tests__/api-redirect-security.test.ts
git commit -m "test(M4/api): cross-origin auth strip (two servers) + HTTPS->HTTP reject (decideRedirect unit) + socket-idle timeout + timeout-constant wiring"
```

### Task 4.1c — Failing `api-request.test.ts` (submitGeneration + pollOperation + buildRequestBody)

`submitGeneration` and `pollOperation` ship in M4 but are only ever exercised through `generate.test.ts` where the whole `@veo-core/api` module is mocked — so their real URL building, non-2xx throw, missing-name throw, `error.message` propagation, and `videos[0]` extraction never run under test. `buildRequestBody` (the cross-cutting parameter passthrough contract, including the `videoExtensionInput` drop) is likewise unasserted. Cover both here. Task 4.2 is updated below to export `buildRequestBody` and to make the API host overridable via `opts.apiHost` so the local http server can stand in.

`/home/giuseppe/claude/veo-tools/skills/_shared/veo-core/__tests__/api-request.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import * as http from 'node:http'
import { submitGeneration, pollOperation, buildRequestBody } from '@veo-core/api'
import type { VeoConfig } from '@veo-core/types'

let server: http.Server
let port: number
let lastBody: any
let nextStatus = 200
let nextResponse = ''

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      lastBody = raw ? JSON.parse(raw) : undefined
      res.writeHead(nextStatus, { 'content-type': 'application/json' })
      res.end(nextResponse)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  port = (server.address() as { port: number }).port
})
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
})
beforeEach(() => {
  lastBody = undefined
  nextStatus = 200
  nextResponse = ''
})

// The local http server stands in for the Vertex host; opts.apiHost makes the
// scheme+host overridable for tests (production callers omit it -> https + real host).
const opts = () => ({ projectId: 'p', location: 'us-central1', apiHost: `http://127.0.0.1:${port}` })

const cfg = (over: Partial<VeoConfig> = {}): VeoConfig => ({
  prompt: 'a sunset',
  model: 'veo-3.1-generate-001',
  outputPath: '/tmp/x.mp4',
  ...over,
})

describe('submitGeneration', () => {
  it('returns the operation name on 200', async () => {
    nextResponse = JSON.stringify({ name: 'projects/p/operations/abc' })
    const name = await submitGeneration(cfg(), 'tok', opts())
    expect(name).toBe('projects/p/operations/abc')
  })
  it('throws with body capped at 1KB on a 4xx', async () => {
    nextStatus = 400
    nextResponse = 'E'.repeat(4096)
    let err: Error | undefined
    try { await submitGeneration(cfg(), 'tok', opts()) } catch (e) { err = e as Error }
    expect(err).toBeDefined()
    expect(err!.message).toMatch(/HTTP 400/)
    expect(err!.message.length).toBeLessThan(1024 + 256) // 1KB cap + framing
  })
  it('throws when the response has no operation name', async () => {
    nextResponse = JSON.stringify({ notName: 'x' })
    await expect(submitGeneration(cfg(), 'tok', opts())).rejects.toThrow(/operation name/i)
  })
})

describe('pollOperation', () => {
  const popts = () => ({ ...opts(), model: 'veo-3.1-generate-001' })
  it('done=false when the operation is still running', async () => {
    nextResponse = JSON.stringify({ done: false })
    const r = await pollOperation('op/1', 'tok', popts())
    expect(r.done).toBe(false)
  })
  it('extracts videos[0] uri/gcsUri when done', async () => {
    nextResponse = JSON.stringify({
      done: true,
      response: { videos: [{ uri: 'https://d/v.mp4', gcsUri: 'gs://b/v.mp4' }] },
    })
    const r = await pollOperation('op/1', 'tok', popts())
    expect(r.done).toBe(true)
    expect(r.videoUrl).toBe('https://d/v.mp4')
    expect(r.gcsUri).toBe('gs://b/v.mp4')
  })
  it('propagates error.message from the operation', async () => {
    nextResponse = JSON.stringify({ done: true, error: { message: 'quota exceeded' } })
    await expect(pollOperation('op/1', 'tok', popts())).rejects.toThrow(/quota exceeded/)
  })
})

describe('buildRequestBody — cross-cutting parameter passthrough', () => {
  it('maps every cross-cutting parameter that is set', () => {
    const body = buildRequestBody(cfg({
      aspectRatio: '9:16',
      durationSeconds: 8,
      resolution: '1080p',
      generateAudio: false,
      sampleCount: 2,
      seed: 42,
      negativePrompt: 'text, logos',
      enhancePrompt: false,
      storageUri: 'gs://b/o',
      personGeneration: 'allow_adult',
      addWatermark: false,
      includeRaiReason: true,
    })) as { instances: any[]; parameters: Record<string, unknown> }
    const p = body.parameters
    expect(p.aspectRatio).toBe('9:16')
    expect(p.durationSeconds).toBe(8)
    expect(p.resolution).toBe('1080p')
    expect(p.generateAudio).toBe(false)   // false must survive (not dropped as falsy)
    expect(p.sampleCount).toBe(2)
    expect(p.seed).toBe(42)
    expect(p.negativePrompt).toBe('text, logos')
    expect(p.enhancePrompt).toBe(false)
    expect(p.storageUri).toBe('gs://b/o')
    expect(p.personGeneration).toBe('allow_adult')
    expect(p.addWatermark).toBe(false)
    expect(p.includeRaiReason).toBe(true)
    expect(body.instances[0].prompt).toBe('a sunset')
  })

  it('omits parameters that are not set (no present-but-undefined keys)', () => {
    const body = buildRequestBody(cfg()) as { parameters: Record<string, unknown> }
    for (const key of [
      'aspectRatio', 'durationSeconds', 'resolution', 'generateAudio', 'sampleCount',
      'seed', 'negativePrompt', 'enhancePrompt', 'storageUri', 'personGeneration',
      'addWatermark', 'includeRaiReason',
    ]) {
      expect(key in body.parameters).toBe(false)
    }
  })

  it('drops videoExtensionInput from the request body (Rule #10 clean-call half)', () => {
    const body = buildRequestBody(cfg({ videoExtensionInput: 'op-name-or-uri' })) as {
      instances: any[]; parameters: Record<string, unknown>
    }
    expect('videoExtensionInput' in body.parameters).toBe(false)
    expect('videoExtensionInput' in body.instances[0]).toBe(false)
    expect(JSON.stringify(body)).not.toContain('op-name-or-uri')
  })
})
```

Run `npm test` — expect red: `Cannot find module '@veo-core/api'` (api.ts does not exist yet; also `buildRequestBody`/`apiHost` are added by the updated Task 4.2).

```bash
git add skills/_shared/veo-core/__tests__/api-request.test.ts
git commit -m "test(M4/api): submitGeneration + pollOperation + buildRequestBody parameter passthrough (incl. videoExtensionInput drop)"
```

### Task 4.2 — Implement `api.ts`

> **Spec deviation**: The spec types section (line 196) describes `submitGeneration(config, token): Promise<operationName>` and `pollOperation(opName, token)` as 2-argument. This plan implements them with an extra `opts: { projectId: string; location: string; model? }` argument because the Vertex endpoint URL needs project + location to be built and we keep the functions pure (no `process.env` reads inside). The public shape remains testable; M6's `generate.ts` is the only caller and feeds the env values in once. This deviation is intentional and additive (third arg is required, not optional, but only one internal caller exists).

`/home/giuseppe/claude/veo-tools/skills/_shared/veo-core/api.ts`:

```ts
// api.ts — Vertex AI Veo HTTP surface + hardened downloadFile.
import * as http from 'node:http'
import * as https from 'node:https'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { URL } from 'node:url'
import { Storage } from '@google-cloud/storage'
import { encodeImage } from '@veo-core/image-helpers'
import type { VeoConfig } from '@veo-core/types'

const MAX_REDIRECTS = 10
export const SOCKET_IDLE_MS = 30_000
export const TOTAL_DEADLINE_MS = 15 * 60 * 1000
const ERROR_BODY_CAP = 1024
export const REQUEST_TIMEOUT_MS = 30_000 // for makeRequest only (predict/poll)

// apiHost defaults to the real Vertex host (scheme included). Tests override it
// with `http://127.0.0.1:<port>` to stand a local server in for the API.
function defaultApiHost(location: string): string {
  return `https://${location}-aiplatform.googleapis.com`
}

function getEndpoint(apiHost: string, projectId: string, location: string, model: string): string {
  return (
    `${apiHost}/v1/projects/${projectId}` +
    `/locations/${location}/publishers/google/models/${model}:predictLongRunning`
  )
}

function getOperationEndpoint(apiHost: string, projectId: string, location: string, model: string): string {
  // Operation names come back fully qualified from Vertex; for cleanliness we
  // build the fetchPredictOperation URL from the model parent.
  return (
    `${apiHost}/v1/projects/${projectId}` +
    `/locations/${location}/publishers/google/models/${model}:fetchPredictOperation`
  )
}

export function buildRequestBody(c: VeoConfig): unknown {
  const instances: Record<string, unknown> = { prompt: c.prompt }
  if (c.image)      instances.image     = encodeImage(c.image)
  if (c.lastFrame)  instances.lastFrame = encodeImage(c.lastFrame)
  if (c.referenceImages && c.referenceImages.length) {
    instances.referenceImages = c.referenceImages.map((i) => ({
      referenceType: 'asset',
      image: encodeImage(i),
    }))
  }

  const parameters: Record<string, unknown> = {}
  if (c.aspectRatio       !== undefined) parameters.aspectRatio       = c.aspectRatio
  if (c.durationSeconds   !== undefined) parameters.durationSeconds   = c.durationSeconds
  if (c.resolution        !== undefined) parameters.resolution        = c.resolution
  if (c.generateAudio     !== undefined) parameters.generateAudio     = c.generateAudio
  if (c.sampleCount       !== undefined) parameters.sampleCount       = c.sampleCount
  if (c.seed              !== undefined) parameters.seed              = c.seed
  if (c.negativePrompt    !== undefined) parameters.negativePrompt    = c.negativePrompt
  if (c.enhancePrompt     !== undefined) parameters.enhancePrompt     = c.enhancePrompt
  if (c.storageUri        !== undefined) parameters.storageUri        = c.storageUri
  if (c.personGeneration  !== undefined) parameters.personGeneration  = c.personGeneration
  if (c.addWatermark      !== undefined) parameters.addWatermark      = c.addWatermark
  if (c.includeRaiReason  !== undefined) parameters.includeRaiReason  = c.includeRaiReason

  return { instances: [instances], parameters }
}

function makeRequest(url: string, method: string, token: string, body?: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib = u.protocol === 'http:' ? http : https
    const req = lib.request(
      {
        method,
        host: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname + u.search,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c as Buffer))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
        res.on('error', reject)
      }
    )
    req.on('timeout', () => req.destroy(new Error(`makeRequest timed out after ${REQUEST_TIMEOUT_MS}ms`)))
    req.on('error', reject)
    if (body !== undefined) req.write(JSON.stringify(body))
    req.end()
  })
}

export async function submitGeneration(
  config: VeoConfig,
  token: string,
  opts: { projectId: string; location: string; apiHost?: string }
): Promise<string> {
  const model = config.model
  if (!model) throw new Error('submitGeneration requires config.model to be resolved')
  const apiHost = opts.apiHost ?? defaultApiHost(opts.location)
  const url = getEndpoint(apiHost, opts.projectId, opts.location, model)
  const { status, body } = await makeRequest(url, 'POST', token, buildRequestBody(config))
  if (status < 200 || status >= 300) {
    throw new Error(`submitGeneration: HTTP ${status} — ${body.slice(0, ERROR_BODY_CAP)}`)
  }
  const parsed = JSON.parse(body) as { name?: string }
  if (!parsed.name) throw new Error(`submitGeneration: missing operation name in response: ${body.slice(0, 256)}`)
  return parsed.name
}

export async function pollOperation(
  operationName: string,
  token: string,
  opts: { projectId: string; location: string; model: string; apiHost?: string }
): Promise<{ done: boolean; videoUrl?: string; gcsUri?: string; raw: unknown }> {
  const apiHost = opts.apiHost ?? defaultApiHost(opts.location)
  const url = getOperationEndpoint(apiHost, opts.projectId, opts.location, opts.model)
  const { status, body } = await makeRequest(url, 'POST', token, { operationName })
  if (status < 200 || status >= 300) {
    throw new Error(`pollOperation: HTTP ${status} — ${body.slice(0, ERROR_BODY_CAP)}`)
  }
  const parsed = JSON.parse(body) as {
    done?: boolean
    response?: { videos?: Array<{ gcsUri?: string; bytesBase64Encoded?: string; uri?: string }> }
    error?: { message?: string }
  }
  if (parsed.error?.message) throw new Error(`pollOperation: ${parsed.error.message}`)
  if (!parsed.done) return { done: false, raw: parsed }
  const v = parsed.response?.videos?.[0]
  return {
    done: true,
    videoUrl: v?.uri,
    gcsUri: v?.gcsUri,
    raw: parsed,
  }
}

// downloadFile — HTTPS + gs:// dual scheme. Atomic write to randomly-suffixed .tmp then rename.
// opts.socketIdleMs overrides the idle watchdog (tests shorten it; production omits).
export async function downloadFile(
  target: string,
  outputPath: string,
  token: string,
  opts: { socketIdleMs?: number } = {}
): Promise<void> {
  if (target.startsWith('gs://')) {
    return downloadFromGcs(target, outputPath)
  }
  if (target.startsWith('http://') || target.startsWith('https://')) {
    return downloadFromHttps(target, outputPath, token, opts.socketIdleMs ?? SOCKET_IDLE_MS)
  }
  throw new Error(`downloadFile: unsupported scheme — must be http://, https://, or gs:// — got: ${target}`)
}

// decideRedirect — pure redirect policy: reject HTTPS->HTTP downgrades outright and
// report whether the hop crosses origins (so the caller strips Authorization per RFC 6454).
// Exported so the policy is unit-testable without TLS / sockets.
export function decideRedirect(
  currentUrl: URL,
  location: string
): { nextUrl: URL; crossOrigin: boolean } {
  const nextUrl = new URL(location, currentUrl)
  if (currentUrl.protocol === 'https:' && nextUrl.protocol === 'http:') {
    throw new Error(`downloadFile: refusing HTTPS -> HTTP redirect (${currentUrl.href} -> ${nextUrl.href})`)
  }
  return { nextUrl, crossOrigin: originOf(nextUrl) !== originOf(currentUrl) }
}

function tmpSuffixedPath(outputPath: string): string {
  const random = crypto.randomBytes(8).toString('hex')
  return `${outputPath}.${random}.tmp`
}

async function downloadFromGcs(gcsUri: string, outputPath: string): Promise<void> {
  const tmp = tmpSuffixedPath(outputPath)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const rest = gcsUri.slice(5)
  const slash = rest.indexOf('/')
  if (slash === -1) throw new Error(`Malformed gs:// URI: ${gcsUri}`)
  const bucket = rest.slice(0, slash)
  const object = rest.slice(slash + 1)
  const storage = new Storage()
  try {
    await storage.bucket(bucket).file(object).download({ destination: tmp })
    fs.renameSync(tmp, outputPath)
  } catch (e) {
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
    throw e
  }
}

function originOf(u: URL): string {
  return `${u.protocol}//${u.host}`
}

async function downloadFromHttps(
  initialUrl: string,
  outputPath: string,
  token: string,
  socketIdleMs: number
): Promise<void> {
  const tmp = tmpSuffixedPath(outputPath)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })

  const deadline = Date.now() + TOTAL_DEADLINE_MS
  let currentUrl = new URL(initialUrl)
  let authorizationActive = true
  let redirects = 0

  while (true) {
    if (Date.now() > deadline) {
      try { fs.unlinkSync(tmp) } catch { /* ignore */ }
      throw new Error(`downloadFile: total deadline exceeded (${TOTAL_DEADLINE_MS}ms)`)
    }

    const result = await new Promise<
      | { kind: 'done' }
      | { kind: 'redirect'; location: string }
      | { kind: 'error'; message: string }
    >((resolve) => {
      const isHttps = currentUrl.protocol === 'https:'
      const lib = isHttps ? https : http
      const headers: Record<string, string> = {}
      if (authorizationActive) headers.authorization = `Bearer ${token}`

      const req = lib.request(
        {
          method: 'GET',
          host: currentUrl.hostname,
          port: currentUrl.port || (isHttps ? 443 : 80),
          path: currentUrl.pathname + currentUrl.search,
          headers,
        },
        (res) => {
          const status = res.statusCode ?? 0
          if (status >= 300 && status < 400 && res.headers.location) {
            resolve({ kind: 'redirect', location: res.headers.location })
            res.resume()
            return
          }
          if (status < 200 || status >= 300) {
            const chunks: Buffer[] = []
            let collected = 0
            res.on('data', (c: Buffer) => {
              if (collected < ERROR_BODY_CAP) {
                chunks.push(c.slice(0, ERROR_BODY_CAP - collected))
                collected += c.length
              }
            })
            res.on('end', () =>
              resolve({
                kind: 'error',
                message: `downloadFile: HTTP ${status} ${currentUrl.href} — ${Buffer.concat(chunks).toString('utf8').slice(0, ERROR_BODY_CAP)}`,
              })
            )
            res.on('error', (e) => resolve({ kind: 'error', message: String(e) }))
            return
          }
          const ws = fs.createWriteStream(tmp)
          let idle: NodeJS.Timeout
          const armIdle = () => {
            if (idle) clearTimeout(idle)
            idle = setTimeout(() => req.destroy(new Error(`socket idle > ${socketIdleMs}ms`)), socketIdleMs)
          }
          armIdle()
          res.on('data', () => armIdle())
          res.pipe(ws)
          ws.on('finish', () => {
            clearTimeout(idle)
            resolve({ kind: 'done' })
          })
          ws.on('error', (e) => {
            clearTimeout(idle)
            resolve({ kind: 'error', message: String(e) })
          })
        }
      )
      req.on('error', (e) => resolve({ kind: 'error', message: String(e) }))
      req.end()
    })

    if (result.kind === 'done') {
      fs.renameSync(tmp, outputPath)
      return
    }
    if (result.kind === 'error') {
      try { fs.unlinkSync(tmp) } catch { /* ignore */ }
      throw new Error(result.message)
    }
    // Redirect
    redirects++
    if (redirects > MAX_REDIRECTS) {
      try { fs.unlinkSync(tmp) } catch { /* ignore */ }
      throw new Error(`downloadFile: too many redirects (>${MAX_REDIRECTS})`)
    }
    let decision: { nextUrl: URL; crossOrigin: boolean }
    try {
      // decideRedirect rejects HTTPS->HTTP downgrades and flags cross-origin hops.
      decision = decideRedirect(currentUrl, result.location)
    } catch (e) {
      try { fs.unlinkSync(tmp) } catch { /* ignore */ }
      throw e
    }
    // Cross-origin Authorization stripping (RFC 6454)
    if (decision.crossOrigin) authorizationActive = false
    currentUrl = decision.nextUrl
  }
}
```

Run `npm test` — expect green.

```bash
git add skills/_shared/veo-core/api.ts
git commit -m "feat(M4/api): submitGeneration + pollOperation + hardened downloadFile (redirect cap, cross-origin auth stripping, atomic write)"
```

### Milestone Gate M4

```bash
npm test -- api api-redirect-security api-request
```

Expected: all green across all three M4 test files. Required coverage:
- `api.test.ts` — atomic-write, redirect-cap, error-body-cap, no-stranded-tmp, scheme-rejection.
- `api-redirect-security.test.ts` — cross-origin Authorization stripping (two real servers; the bearer token must NOT reach the second origin), same-origin Authorization retained, HTTPS→HTTP rejection (via `decideRedirect`), socket-idle timeout, and the three exported timeout constants wired to 30000 / 30000 / 900000.
- `api-request.test.ts` — `submitGeneration` (200→name, 4xx→throw with 1KB-capped body, missing-name→throw), `pollOperation` (done=false, videos[0] uri/gcsUri extraction, error.message propagation), and `buildRequestBody` (every cross-cutting parameter mapped including `generateAudio:false`/`addWatermark:false`/`includeRaiReason:true`, absent fields omitted, `videoExtensionInput` dropped from instances and parameters).

---

## M5 — `validation.ts`

**Goal**: Implement `FOUNDATION_RULES` (rules #1–#10), the `createValidator({baseRules, extraRules})` factory with per-rule try/catch, and `validateConfig = createValidator({ baseRules: FOUNDATION_RULES })`. Apply auto-fixes + remaining defaults. Never throw.

**Dependencies**: M1.

**Gate**: `validation.test.ts` (every rule, valid + invalid) + `auto-fix.test.ts` (every auto-correction) green. Ordering-invariant test green. Rule-throw-is-caught test green. resolveDefaultModel-throws path returns `{valid:false}` rather than propagating.

### Task 5.1 — Failing `validation.test.ts`

`/home/giuseppe/claude/veo-tools/skills/_shared/veo-core/__tests__/validation.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { validateConfig, createValidator, FOUNDATION_RULES } from '@veo-core/validation'
import { _resetDefaultModelCacheForTests } from '@veo-core/constants'
import type { VeoConfig, ValidationRule } from '@veo-core/types'

beforeEach(() => _resetDefaultModelCacheForTests())

const ok = (over: Partial<VeoConfig> = {}): VeoConfig => ({
  prompt: 'a sunset over the sea',
  outputPath: '/tmp/x.mp4',
  ...over,
})

describe('validateConfig — never throws', () => {
  it('returns a discriminated union even on garbage', () => {
    const r = validateConfig({ prompt: '', outputPath: '/tmp/x.mp4' } as VeoConfig)
    expect(r).toHaveProperty('valid')
  })
})

describe('Rule #9 — outputPath XOR storageUri', () => {
  it('neither set => error', () => {
    const r = validateConfig({ prompt: 'x' } as VeoConfig)
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.join(' ')).toMatch(/output destination required/i)
  })
  it('both set => error', () => {
    const r = validateConfig(ok({ storageUri: 'gs://b/o' }))
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.join(' ')).toMatch(/ambiguous output/i)
  })
  it('outputPath only => valid', () => {
    const r = validateConfig(ok())
    expect(r.valid).toBe(true)
  })
  it('storageUri only => valid', () => {
    const r = validateConfig({ prompt: 'x', storageUri: 'gs://b/o' })
    expect(r.valid).toBe(true)
  })
})

describe('Rule #1 — durations per model', () => {
  it('Veo 3.x rejects duration=5', () => {
    const r = validateConfig(ok({ durationSeconds: 5 }))
    expect(r.valid).toBe(false)
  })
  it('Veo 3.x accepts 4/6/8', () => {
    for (const d of [4, 6, 8]) expect(validateConfig(ok({ durationSeconds: d })).valid).toBe(true)
  })
  it('Veo 2 rejects 7 (the previous guess)', () => {
    const r = validateConfig(ok({ model: 'veo-2.0-generate-001', durationSeconds: 7, generateAudio: false }))
    expect(r.valid).toBe(false)
  })
  it('unknown model => soft warning, not error', () => {
    const r = validateConfig(ok({ model: 'veo-9.9-fake', durationSeconds: 99 }))
    if (r.valid) expect(r.warnings.some((w) => /unknown model/i.test(w))).toBe(true)
  })
})

describe('Rule #2 — 1080p/4k require duration=8', () => {
  it('1080p + undefined duration => auto-fix to 8', () => {
    const r = validateConfig(ok({ resolution: '1080p' }))
    expect(r.valid).toBe(true)
    if (r.valid) {
      expect(r.autoFixed.durationSeconds).toBe(8)
      expect(r.autoFixMessages.join(' ')).toMatch(/duration to 8/i)
    }
  })
  it('1080p + explicit 6 => hard error', () => {
    const r = validateConfig(ok({ resolution: '1080p', durationSeconds: 6 }))
    expect(r.valid).toBe(false)
  })
  it('4k + explicit 4 => hard error', () => {
    const r = validateConfig(ok({ resolution: '4k', durationSeconds: 4 }))
    expect(r.valid).toBe(false)
  })
})

describe('Rule #3 / #4 — Veo 2 constraints', () => {
  it('Veo 2 + undefined audio => auto-fix to false', () => {
    const r = validateConfig(ok({ model: 'veo-2.0-generate-001', resolution: '720p', durationSeconds: 8 }))
    expect(r.valid).toBe(true)
    if (r.valid) {
      expect(r.autoFixed.generateAudio).toBe(false)
      expect(r.autoFixMessages.join(' ')).toMatch(/Veo 2 doesn't support audio/i)
    }
  })
  it('Veo 2 + explicit audio=true => hard error', () => {
    const r = validateConfig(ok({ model: 'veo-2.0-generate-001', generateAudio: true, durationSeconds: 8, resolution: '720p' }))
    expect(r.valid).toBe(false)
  })
  it('Veo 2 + 1080p => hard error', () => {
    const r = validateConfig(ok({ model: 'veo-2.0-generate-001', resolution: '1080p', durationSeconds: 8, generateAudio: false }))
    expect(r.valid).toBe(false)
  })
})

describe('Rule #5 — token soft warning, never rejects', () => {
  it('long prompt => warning, still valid', () => {
    const long = 'x '.repeat(2000)
    const r = validateConfig(ok({ prompt: long }))
    expect(r.valid).toBe(true)
    if (r.valid) expect(r.warnings.some((w) => /token/i.test(w))).toBe(true)
  })
})

describe('Rule #6 — personGeneration regional', () => {
  it('EU + allow_all => auto-fix to allow_adult', () => {
    const r = createValidator({ baseRules: FOUNDATION_RULES })(ok({ personGeneration: 'allow_all' }), { region: 'eu' })
    expect(r.valid).toBe(true)
    if (r.valid) {
      expect(r.autoFixed.personGeneration).toBe('allow_adult')
      expect(r.autoFixMessages.join(' ')).toMatch(/region/i)
    }
  })
})

describe('Rule #7 — sampleCount per model', () => {
  it('Veo 2 + sampleCount=4 => error (max=2)', () => {
    const r = validateConfig(ok({ model: 'veo-2.0-generate-001', sampleCount: 4, resolution: '720p', durationSeconds: 8, generateAudio: false }))
    expect(r.valid).toBe(false)
  })
  it('Veo 3.x + sampleCount=4 => valid', () => {
    const r = validateConfig(ok({ sampleCount: 4 }))
    expect(r.valid).toBe(true)
  })
})

describe('Rule #8 — aspect ratio enum', () => {
  it('rejects 21:9', () => {
    const r = validateConfig(ok({ aspectRatio: '21:9' as unknown as '16:9' }))
    expect(r.valid).toBe(false)
  })
  it('accepts 9:16', () => {
    expect(validateConfig(ok({ aspectRatio: '9:16' })).valid).toBe(true)
  })
})

describe('Rule #10 — forward-declared field warning', () => {
  it('videoExtensionInput set => warning, still valid', () => {
    const r = validateConfig(ok({ videoExtensionInput: 'op-name-or-uri' }))
    expect(r.valid).toBe(true)
    if (r.valid) expect(r.warnings.some((w) => /videoExtensionInput/.test(w))).toBe(true)
  })
})

describe('validateConfig — internal ordering invariant', () => {
  it('step 1 resolves default model before any rule sees the config', () => {
    const seen: Array<string | undefined> = []
    const spy: ValidationRule = (cfg) => {
      seen.push(cfg.model)
      return { kind: 'ok' }
    }
    const v = createValidator({ baseRules: [spy] })
    v(ok())
    expect(seen[0]).toBe('veo-3.1-generate-001')
  })
})

describe('createValidator — per-rule try/catch', () => {
  it('a thrown rule is caught and converted to {valid:false}', () => {
    const boom: ValidationRule = () => { throw new Error('synthetic') }
    const r = createValidator({ baseRules: [boom] })(ok())
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.join(' ')).toMatch(/threw|synthetic/i)
  })
})
```

Run `npm test` — expect red: `Cannot find module '@veo-core/validation'` (validation.ts does not exist yet).

```bash
git add skills/_shared/veo-core/__tests__/validation.test.ts
git commit -m "test(M5/validation): rules #1-10 + ordering invariant + rule-throw-is-caught"
```

### Task 5.2 — Failing `auto-fix.test.ts`

`/home/giuseppe/claude/veo-tools/skills/_shared/veo-core/__tests__/auto-fix.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { validateConfig, createValidator, FOUNDATION_RULES } from '@veo-core/validation'
import { _resetDefaultModelCacheForTests } from '@veo-core/constants'
import type { VeoConfig } from '@veo-core/types'

beforeEach(() => _resetDefaultModelCacheForTests())

const base = (over: Partial<VeoConfig> = {}): VeoConfig => ({
  prompt: 'x',
  outputPath: '/tmp/x.mp4',
  ...over,
})

describe('auto-corrections table', () => {
  it('row 1: resolution=1080p AND duration=undefined => duration=8', () => {
    const r = validateConfig(base({ resolution: '1080p' }))
    if (!r.valid) throw new Error('expected valid')
    expect(r.autoFixed.durationSeconds).toBe(8)
    expect(r.autoFixMessages.some((m) => /1080p|4K/i.test(m))).toBe(true)
  })
  it('row 2: region=EU AND personGeneration=allow_all => allow_adult', () => {
    const r = createValidator({ baseRules: FOUNDATION_RULES })(base({ personGeneration: 'allow_all' }), { region: 'eu' })
    if (!r.valid) throw new Error('expected valid')
    expect(r.autoFixed.personGeneration).toBe('allow_adult')
  })
  it('row 3: model=veo-2 AND audio=undefined => audio=false', () => {
    const r = validateConfig(base({ model: 'veo-2.0-generate-001', resolution: '720p', durationSeconds: 8 }))
    if (!r.valid) throw new Error('expected valid')
    expect(r.autoFixed.generateAudio).toBe(false)
  })
  it('row 4: model=veo-2 AND audio=true (explicit) => hard error (no auto-fix)', () => {
    const r = validateConfig(base({ model: 'veo-2.0-generate-001', generateAudio: true, resolution: '720p', durationSeconds: 8 }))
    expect(r.valid).toBe(false)
  })
})

describe('autoFixMessages discipline', () => {
  it('does NOT mention silent default application (aspectRatio/resolution defaulting)', () => {
    const r = validateConfig(base())
    if (!r.valid) throw new Error('expected valid')
    expect(r.autoFixMessages.some((m) => /aspectRatio|resolution/i.test(m))).toBe(false)
    expect(r.autoFixed.aspectRatio).toBe('16:9')
    expect(r.autoFixed.resolution).toBe('720p')
  })
})
```

Run `npm test` — expect red: the missing-module error from Task 5.1 still applies (`@veo-core/validation` does not exist yet); `auto-fix.test.ts` now also red for the same reason. Task 5.3's implementation will turn both 5.1 and 5.2 green simultaneously.

```bash
git add skills/_shared/veo-core/__tests__/auto-fix.test.ts
git commit -m "test(M5/auto-fix): every auto-correction row + autoFixMessages discipline"
```

### Task 5.3 — Implement `validation.ts`

`/home/giuseppe/claude/veo-tools/skills/_shared/veo-core/validation.ts`:

```ts
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
  const restricted = ctx.region && ['eu', 'uk', 'ch', 'mena'].includes(ctx.region)
  if (!restricted) return { kind: 'ok' }
  return {
    kind: 'autoFix',
    patch: { personGeneration: 'allow_adult' },
    message: `Region restriction (${ctx.region}): personGeneration set to allow_adult`,
  }
}

const ruleSampleCountPerModel: ValidationRule = (c) => {
  if (c.sampleCount === undefined) return { kind: 'ok' }
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
```

Run `npm test` — expect green.

```bash
git add skills/_shared/veo-core/validation.ts
git commit -m "feat(M5/validation): FOUNDATION_RULES + createValidator factory + validateConfig (never throws)"
```

### Milestone Gate M5

```bash
npm test -- validation auto-fix
```

Expected: every rule + every auto-correction green; ordering-invariant test green; rule-throw-is-caught test green.

---

## M6 — `generate.ts`

**Goal**: Orchestrate auth → validate → submit → poll → download/skip. One-argument signature.

**Dependencies**: M2 (auth), M3 (pricing — for warnings only), M4 (api), M5 (validation).

**Gate**: `generate.test.ts` green with mocked auth/api modules.

### Task 6.1 — Failing `generate.test.ts`

`/home/giuseppe/claude/veo-tools/skills/_shared/veo-core/__tests__/generate.test.ts`:

```ts
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
```

Run `npm test` — expect red: `Cannot find module '@veo-core/generate'` (generate.ts does not exist yet).

```bash
git add skills/_shared/veo-core/__tests__/generate.test.ts
git commit -m "test(M6/generate): orchestrator happy path + storageUri skip + validation-failure throws"
```

### Task 6.2 — Implement `generate.ts`

`/home/giuseppe/claude/veo-tools/skills/_shared/veo-core/generate.ts`:

```ts
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
```

Run `npm test` — expect green.

```bash
git add skills/_shared/veo-core/generate.ts
git commit -m "feat(M6/generate): generateVideo(config) orchestrator (one-argument, outputPath in config)"
```

### Milestone Gate M6

```bash
npm test
```

All test files green. `npm test` (no filter) is the gate.

---

## M7 — Refactor `skills/veo/scripts/veo-generate.ts`

**Goal**: Convert the existing CLI script into a thin (~150 LOC) entry that imports from `@veo-core/*`. Add the new cross-cutting CLI flags (`--negative-prompt`, `--enhance-prompt`, `--no-enhance-prompt`, `--seed`, `--sample-count`, `--person-generation`, `--storage-uri`, `--add-watermark`, `--no-add-watermark`, `--include-rai-reason`, `--audio`, `--no-audio`).

**Dependencies**: M0–M6.

**Gate**: Script typechecks; `cli-utils.test.ts` green; manual invocation (`ts-node skills/veo/scripts/veo-generate.ts --help`) prints the new flag list. (No paid generation in M7 — that's M13.)

### Task 7.1 — Inspect the current script

```bash
wc -l skills/veo/scripts/veo-generate.ts
```

Record the existing size so the commit body can note the LOC shrinkage when 7.2 replaces it wholesale. (We do not consult the diff; the replacement is complete and the new file is fully literal below.)

### Task 7.1.5 — Failing `cli-utils.test.ts`

The new CLI extracts `parseArgs` + `buildConfig` into a sibling module so we can unit-test the flag plumbing without spawning ts-node. This test pins the behaviour the wholesale replacement in 7.2 must satisfy.

`/home/giuseppe/claude/veo-tools/skills/veo/scripts/__tests__/cli-utils.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { parseArgs, buildConfig } from '../cli-utils'

describe('parseArgs', () => {
  it('rejects unknown flags with exit code 2', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => parseArgs(['--nope'])).toThrow(/exit:2/)
    exit.mockRestore()
    err.mockRestore()
  })

  it('exits 2 when a value-taking flag is missing its value', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => parseArgs(['--prompt'])).toThrow(/exit:2/)
    exit.mockRestore()
    err.mockRestore()
  })
})

describe('buildConfig', () => {
  it('--no-audio sets generateAudio=false', () => {
    const cfg = buildConfig({ '--prompt': 'x', '--no-audio': true })
    expect(cfg.generateAudio).toBe(false)
  })
  it('--audio sets generateAudio=true', () => {
    const cfg = buildConfig({ '--prompt': 'x', '--audio': true })
    expect(cfg.generateAudio).toBe(true)
  })
  it('--duration "4" parses to integer 4', () => {
    const cfg = buildConfig({ '--prompt': 'x', '--duration': '4' })
    expect(cfg.durationSeconds).toBe(4)
  })
  it('--enhance-prompt sets enhancePrompt=true; --no-enhance-prompt sets enhancePrompt=false (last-write-wins follows declaration order)', () => {
    const on  = buildConfig({ '--prompt': 'x', '--enhance-prompt': true })
    const off = buildConfig({ '--prompt': 'x', '--no-enhance-prompt': true })
    expect(on.enhancePrompt).toBe(true)
    expect(off.enhancePrompt).toBe(false)
  })
})
```

Run `npm test` — expect red: `Cannot find module '../cli-utils'` (cli-utils.ts does not exist yet).

```bash
mkdir -p skills/veo/scripts/__tests__
git add skills/veo/scripts/__tests__/cli-utils.test.ts
git commit -m "test(M7): failing parseArgs/buildConfig assertions for veo-generate CLI"
```

### Task 7.2 — Extract `cli-utils.ts` + new thin entry

First create the extracted module that re-exports the testable pure functions.

`/home/giuseppe/claude/veo-tools/skills/veo/scripts/cli-utils.ts`:

```ts
// cli-utils.ts — pure flag plumbing for veo-generate. No side effects on import.
if (!process.env.VITEST) require('../../_shared/veo-core/bootstrap')

import type { VeoConfig } from '@veo-core/types'

export type Flag = { name: string; takesValue: boolean; describe: string }

export const FLAGS: Flag[] = [
  { name: '--prompt',           takesValue: true,  describe: 'text prompt (required)' },
  { name: '--output',           takesValue: true,  describe: 'local path for the generated mp4 (mutually exclusive with --storage-uri)' },
  { name: '--storage-uri',      takesValue: true,  describe: 'gs:// destination (server-side delivery; mutually exclusive with --output)' },
  { name: '--model',            takesValue: true,  describe: 'Veo model id (default: veo-3.1-generate-001)' },
  { name: '--aspect-ratio',     takesValue: true,  describe: '16:9 | 9:16 (default 16:9)' },
  { name: '--duration',         takesValue: true,  describe: 'seconds — Veo 3.x: 4/6/8, Veo 2: 5/6/8' },
  { name: '--resolution',       takesValue: true,  describe: '720p | 1080p | 4k (Veo 2 max 720p)' },
  { name: '--audio',            takesValue: false, describe: 'force audio on' },
  { name: '--no-audio',         takesValue: false, describe: 'force audio off' },
  { name: '--sample-count',     takesValue: true,  describe: '1..MODEL_SAMPLE_MAX[model]' },
  { name: '--seed',             takesValue: true,  describe: 'integer seed, 0–2147483647 (2^31−1); determinism is best-effort on Veo 3' },
  { name: '--negative-prompt',  takesValue: true,  describe: 'exclude content matching this phrase' },
  { name: '--enhance-prompt',   takesValue: false, describe: 'server-side prompt enhancement on' },
  { name: '--no-enhance-prompt',takesValue: false, describe: 'server-side prompt enhancement off' },
  { name: '--person-generation',takesValue: true,  describe: 'allow_all | allow_adult | disallow' },
  { name: '--add-watermark',    takesValue: false, describe: 'add SynthID watermark (default true on Vertex)' },
  { name: '--no-add-watermark', takesValue: false, describe: 'disable SynthID watermark' },
  { name: '--include-rai-reason',takesValue:false, describe: 'include Responsible-AI block reason in error response' },
  { name: '--dry-run',          takesValue: false, describe: 'validate + estimate cost only; do not call API' },
  { name: '--help',             takesValue: false, describe: 'show this help' },
]

export function printHelp(): void {
  const padN = Math.max(...FLAGS.map((f) => f.name.length))
  for (const f of FLAGS) console.log(`  ${f.name.padEnd(padN)}  ${f.describe}`)
}

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const def = FLAGS.find((f) => f.name === a)
    if (!def) {
      console.error(`Unknown flag: ${a}`)
      process.exit(2)
    }
    if (def.takesValue) {
      const v = argv[++i]
      if (v === undefined) {
        console.error(`Flag ${a} requires a value`)
        process.exit(2)
      }
      out[a] = v
    } else {
      out[a] = true
    }
  }
  return out
}

export function buildConfig(flags: Record<string, string | boolean>): VeoConfig {
  const cfg: VeoConfig = { prompt: String(flags['--prompt'] ?? '') }
  if (flags['--output'])             cfg.outputPath        = String(flags['--output'])
  if (flags['--storage-uri'])        cfg.storageUri        = String(flags['--storage-uri'])
  if (flags['--model'])              cfg.model             = String(flags['--model'])
  if (flags['--aspect-ratio'])       cfg.aspectRatio       = flags['--aspect-ratio'] as '16:9' | '9:16'
  if (flags['--duration'])           cfg.durationSeconds   = parseInt(String(flags['--duration']), 10)
  if (flags['--resolution'])         cfg.resolution        = flags['--resolution'] as '720p' | '1080p' | '4k'
  if (flags['--sample-count'])       cfg.sampleCount       = parseInt(String(flags['--sample-count']), 10)
  if (flags['--seed'])               cfg.seed              = parseInt(String(flags['--seed']), 10)
  if (flags['--negative-prompt'])    cfg.negativePrompt    = String(flags['--negative-prompt'])
  if (flags['--person-generation'])  cfg.personGeneration  = flags['--person-generation'] as VeoConfig['personGeneration']
  if (flags['--include-rai-reason']) cfg.includeRaiReason  = true
  if (flags['--audio'])              cfg.generateAudio     = true
  if (flags['--no-audio'])           cfg.generateAudio     = false
  if (flags['--enhance-prompt'])     cfg.enhancePrompt     = true
  if (flags['--no-enhance-prompt'])  cfg.enhancePrompt     = false
  if (flags['--add-watermark'])      cfg.addWatermark      = true
  if (flags['--no-add-watermark'])   cfg.addWatermark      = false
  return cfg
}
```

> **Why the `if (!process.env.VITEST)` guard on the seam bootstrap line:** this module is imported directly by vitest (`cli-utils.test.ts`). Under vitest the `@veo-core/*` alias is supplied by `vitest.config.ts`, and the bare CommonJS `require('../../_shared/veo-core/bootstrap')` cannot be resolved by vite's transform (no `.ts` extension resolution for that bare require), so an unconditional require throws `Cannot find module` at import time and fails the suite. The guard skips bootstrap only under vitest, where it is both unnecessary and unresolvable. The thin **entry** file (`veo-generate.ts`) keeps the bootstrap line **unconditional** — the bootstrap-first invariant lives on the entry, which is never imported by vitest.

Run `npm test` — expect green for `cli-utils.test.ts` (and all previously-green tests still green).

```bash
git add skills/veo/scripts/cli-utils.ts
git commit -m "feat(M7): cli-utils.ts (parseArgs + buildConfig + FLAGS table) — testable seam"
```

Now create the thin entry that imports from `cli-utils.ts`:

`/home/giuseppe/claude/veo-tools/skills/veo/scripts/veo-generate.ts`:

> **Bootstrap-first invariant**: the `require('../../_shared/veo-core/bootstrap')` line MUST be the first executable statement in the file. The shebang and the one-line comment above are non-executable and acceptable; do not add any `import` above the bootstrap require, because under TypeScript's CommonJS compilation `import` becomes inline `require` (not hoisted), but a future switch to ESM would silently break alias resolution. A relative path is used because the `@veo-core/*` alias does not yet exist until bootstrap runs.

```ts
#!/usr/bin/env ts-node
// veo-generate — thin CLI entry. All semantics live in @veo-core/*.
require('../../_shared/veo-core/bootstrap')

import { generateVideo } from '@veo-core/generate'
import { estimateCost } from '@veo-core/pricing'
import { validateConfig } from '@veo-core/validation'
import { parseArgs, buildConfig, printHelp } from './cli-utils'

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const flags = parseArgs(argv)
  if (flags['--help']) {
    printHelp()
    return
  }
  if (!flags['--prompt']) {
    console.error('--prompt is required')
    process.exit(2)
  }
  const cfg = buildConfig(flags)
  if (flags['--dry-run']) {
    const v = validateConfig(cfg)
    if (!v.valid) {
      console.error('Invalid:', v.errors.join('; '))
      process.exit(2)
    }
    const cost = estimateCost(v.autoFixed)
    console.log('PRESENT')
    console.log(`  model:           ${v.autoFixed.model}`)
    console.log(`  resolution:      ${v.autoFixed.resolution}`)
    console.log(`  duration:        ${v.autoFixed.durationSeconds}s`)
    console.log(`  audio:           ${v.autoFixed.generateAudio}`)
    if (v.autoFixMessages.length) console.log(`  auto-adjustments:\n    - ${v.autoFixMessages.join('\n    - ')}`)
    if (v.warnings.length)        console.log(`  warnings:\n    - ${v.warnings.join('\n    - ')}`)
    console.log(`  estimated cost:  $${cost.usd.toFixed(2)} (${cost.breakdown})`)
    return
  }
  const result = await generateVideo(cfg)
  console.log(JSON.stringify(result, null, 2))
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
```

```bash
git add skills/veo/scripts/veo-generate.ts
git commit -m "refactor(M7): veo-generate.ts becomes a thin CLI over @veo-core/*"
```

### Task 7.3 — Sanity-check the help text

```bash
ts-node skills/veo/scripts/veo-generate.ts --help
```

Expected: 18-ish lines of flag help. No crash. (No paid API call.)

### Milestone Gate M7

- `--help` prints.
- `--dry-run --prompt "x" --output /tmp/x.mp4` runs without making an API call and prints PRESENT block + cost estimate.

```bash
ts-node skills/veo/scripts/veo-generate.ts --dry-run --prompt "a sunset over the sea" --output /tmp/x.mp4
```

Expected output includes `model: veo-3.1-generate-001`, `resolution: 720p`, `duration: 8s`, `audio: true`, `estimated cost: $X.XX`.

---

## M8 — Refactor `skills/veo-multi-shot/scripts/veo-multi-generate.ts`

**Goal**: Same refactor for the multi-shot script. Composition of N single-shot calls; share the same `@veo-core/*` surface.

**Dependencies**: M7.

**Gate**: Script typechecks; `multi-cli-utils.test.ts` green; `--help` prints. `--dry-run` over a JSON storyboard prints the validation summary for each shot without paid calls.

### Task 8.1 — Inspect current multi-shot script

```bash
wc -l skills/veo-multi-shot/scripts/veo-multi-generate.ts
```

Record the existing size for the commit body. The replacement is wholesale; the diff is not consulted.

### Task 8.1.5 — Failing `multi-cli-utils.test.ts`

`/home/giuseppe/claude/veo-tools/skills/veo-multi-shot/scripts/__tests__/multi-cli-utils.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { loadStoryboard, runDryRun } from '../multi-cli-utils'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veo-multi-test-'))
})
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('loadStoryboard', () => {
  it('throws when the JSON has no shots array', () => {
    const p = path.join(tmpDir, 'bad.json')
    fs.writeFileSync(p, JSON.stringify({ name: 'no shots here' }))
    expect(() => loadStoryboard(p)).toThrow(/shots/)
  })
})

describe('runDryRun', () => {
  it('emits one cost line per valid shot and a total', () => {
    const logs: string[] = []
    const errs: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((s: unknown) => { logs.push(String(s)) })
    const err = vi.spyOn(console, 'error').mockImplementation((s: unknown) => { errs.push(String(s)) })
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    const sb = {
      shots: [
        { prompt: 'a', outputPath: '/tmp/a.mp4' },
        { prompt: 'b', outputPath: '/tmp/b.mp4' },
      ],
    }
    runDryRun(sb)
    expect(logs.filter((l) => l.startsWith('shot ')).length).toBe(2)
    expect(logs.some((l) => l.startsWith('total estimated cost:'))).toBe(true)
    log.mockRestore(); err.mockRestore(); exit.mockRestore()
  })

  it('exits 2 before touching shot 2 when shot 1 fails validation', () => {
    const errs: string[] = []
    const err = vi.spyOn(console, 'error').mockImplementation((s: unknown) => { errs.push(String(s)) })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    const sb = {
      shots: [
        { prompt: 'a' } as never, // missing outputPath/storageUri → rule #9 fails
        { prompt: 'b', outputPath: '/tmp/b.mp4' },
      ],
    }
    expect(() => runDryRun(sb)).toThrow(/exit:2/)
    expect(errs.some((s) => /shot 0/.test(s))).toBe(true)
    log.mockRestore(); err.mockRestore(); exit.mockRestore()
  })
})
```

Run `npm test` — expect red: `Cannot find module '../multi-cli-utils'` (the module does not exist yet).

```bash
mkdir -p skills/veo-multi-shot/scripts/__tests__
git add skills/veo-multi-shot/scripts/__tests__/multi-cli-utils.test.ts
git commit -m "test(M8): failing loadStoryboard + runDryRun assertions"
```

### Task 8.2 — Extract `multi-cli-utils.ts` + new thin entry

`/home/giuseppe/claude/veo-tools/skills/veo-multi-shot/scripts/multi-cli-utils.ts`:

```ts
// multi-cli-utils.ts — pure storyboard helpers for veo-multi-generate.
if (!process.env.VITEST) require('../../_shared/veo-core/bootstrap')

import * as fs from 'node:fs'
import { estimateCost } from '@veo-core/pricing'
import { validateConfig } from '@veo-core/validation'
import type { VeoConfig } from '@veo-core/types'

export type Storyboard = { shots: VeoConfig[] }

export function loadStoryboard(p: string): Storyboard {
  const raw = fs.readFileSync(p, 'utf8')
  const parsed = JSON.parse(raw)
  if (!parsed || !Array.isArray(parsed.shots)) {
    throw new Error(`storyboard missing "shots" array: ${p}`)
  }
  return parsed as Storyboard
}

export function runDryRun(sb: Storyboard): void {
  let totalCost = 0
  for (const [i, shot] of sb.shots.entries()) {
    const v = validateConfig(shot)
    if (!v.valid) {
      console.error(`shot ${i}: invalid — ${v.errors.join('; ')}`)
      process.exit(2)
    }
    const cost = estimateCost(v.autoFixed)
    totalCost += cost.usd
    console.log(`shot ${i}: ${cost.breakdown} — $${cost.usd.toFixed(2)}`)
  }
  console.log(`total estimated cost: $${totalCost.toFixed(2)}`)
}
```

> **Why the `if (!process.env.VITEST)` guard on the seam bootstrap line:** same rationale as the M7 seam (`cli-utils.ts`) — this module is imported directly by vitest (`multi-cli-utils.test.ts`), where the `@veo-core/*` alias comes from `vitest.config.ts` and the bare `require('../../_shared/veo-core/bootstrap')` is unresolvable by vite's transform. An unconditional require throws `Cannot find module` and fails the suite; the guard skips it only under vitest. The thin **entry** file (`veo-multi-generate.ts`) keeps the bootstrap line **unconditional**.

Run `npm test` — expect green for `multi-cli-utils.test.ts`.

```bash
git add skills/veo-multi-shot/scripts/multi-cli-utils.ts
git commit -m "feat(M8): multi-cli-utils.ts (loadStoryboard + runDryRun) — testable seam"
```

Now create the thin entry that imports from `multi-cli-utils.ts`:

`/home/giuseppe/claude/veo-tools/skills/veo-multi-shot/scripts/veo-multi-generate.ts`:

> **Bootstrap-first invariant**: same as M7 Task 7.2 — the `require('../../_shared/veo-core/bootstrap')` line must be the first executable statement.

```ts
#!/usr/bin/env ts-node
// veo-multi-generate — thin CLI: load a storyboard JSON, validate each shot,
// optionally execute sequentially. All semantics in @veo-core/*.
require('../../_shared/veo-core/bootstrap')

import { generateVideo } from '@veo-core/generate'
import { loadStoryboard, runDryRun } from './multi-cli-utils'

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  let storyboardPath = ''
  let dryRun = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--storyboard') storyboardPath = argv[++i] ?? '' // ?? '' satisfies noUncheckedIndexedAccess; empty path still hits the `--storyboard required` exit-2 guard below
    else if (argv[i] === '--dry-run') dryRun = true
    else if (argv[i] === '--help') {
      console.log('--storyboard PATH  storyboard JSON with {shots: VeoConfig[]}')
      console.log('--dry-run           validate + cost only')
      return
    }
  }
  if (!storyboardPath) { console.error('--storyboard required'); process.exit(2) }
  const sb = loadStoryboard(storyboardPath)

  // Validate + cost every shot (exits 2 on first invalid shot — no paid call yet)
  runDryRun(sb)
  if (dryRun) return

  for (const [i, shot] of sb.shots.entries()) {
    console.log(`generating shot ${i}...`)
    const r = await generateVideo(shot)
    console.log(JSON.stringify(r, null, 2))
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1) })
```

```bash
git add skills/veo-multi-shot/scripts/veo-multi-generate.ts
git commit -m "refactor(M8): veo-multi-generate.ts becomes thin CLI over @veo-core/*"
```

### Milestone Gate M8

```bash
echo '{"shots":[{"prompt":"sunset","outputPath":"/tmp/a.mp4"},{"prompt":"sunrise","outputPath":"/tmp/b.mp4"}]}' > /tmp/sb.json
ts-node skills/veo-multi-shot/scripts/veo-multi-generate.ts --storyboard /tmp/sb.json --dry-run
```

Expected: two `shot N: ...` lines + total cost.

---

## M9 — `skills/veo/SKILL.md` updates

**Goal**: Update SKILL.md to reflect the 7-value USE CASE enum, context-aware audio default (with a deterministic Phase 1 `--no-audio` derivation), new model decision table, the 4-phase PRESENT format (`READY FOR REVIEW`, settings, auto-adjustments, validation warnings, cost estimate from `estimateCost()`, "Shall I generate"), the rewritten workflow phases (Phase 2 CRAFT 6-element formula + negativePrompt auto-suggestion; Phase 3 VALIDATE softened rules + `validateConfig()` invocation; Phase 5 GENERATE enriched error handling; Phase 6 ITERATE new diagnostic rows), and a New parameters section documenting every cross-cutting flag with an example.

**Dependencies**: M5, M6 (so behaviour described in SKILL.md matches code).

**Gate**: see Milestone Gate M9 below — every phase edit and the new-params section have a grep check.

### Task 9.1 — Read current SKILL.md

```bash
wc -l skills/veo/SKILL.md
grep -n "USE CASE" skills/veo/SKILL.md
```

> **Commit grouping**: Tasks 9.2–9.9 (enum + use-case defaults + Phase 1 audio derivation + PRESENT format + model table + Phase 2 CRAFT + Phase 3 VALIDATE + Phase 4 cost note + new-params section) constitute *one logical change* — the core M9 alignment of SKILL.md with the new enum, context-aware audio, and workflow phases — and ship in a single commit at the end of 9.9. Tasks 9.10 (Phase 5 GENERATE) and 9.11 (Phase 6 ITERATE) are independently meaningful workflow rewrites and get their own commits.

### Task 9.2 — Edit Phase 1 USE CASE enum

Use the Edit tool. Replace the existing 5-value enum line with:

> `USE CASE: hero-background | marketing | social | product | ambient | loop | storytelling`

Add a sub-section just below the enum line:

```markdown
### Use-case-aware defaults

| Use case          | Audio default | Duration default (s) |
|-------------------|---------------|----------------------|
| hero-background   | off           | 4                    |
| ambient           | off           | 4                    |
| loop              | off           | 4                    |
| social            | on            | 8                    |
| marketing         | on            | 8                    |
| product           | on            | 8                    |
| storytelling      | on            | 8                    |

_Notes:_
- Explicit `--audio` / `--no-audio` always wins.
- Library/CLI default duration is `8`; the USE CASE override is a *Phase 1 SKILL.md hint*, not a library default.
- Unspecified use case → audio defaults to `on` (Veo 3.1 API native default); duration defaults to `8`.
```

### Task 9.3 — Edit Phase 4 PRESENT format

Replace the existing PRESENT section in SKILL.md with the literal block below (quoted verbatim from spec PR #1 §4). The explicit-override annotation example (`Audio: on (explicit --audio override; hero-background default is off)`) is included.

````markdown
## Phase 4 — PRESENT

```
READY FOR REVIEW:

Prompt: [...]
Settings:
  Model: veo-3.1-generate-001 (GA quality)
  Aspect: 16:9
  Duration: 8s
  Resolution: 1080p
  Audio: on (explicit --audio override; hero-background default is off)
  Person generation: allow_adult
  Negative prompt: "text, logos, watermarks"

Auto-adjustments applied:
  - Duration set to 8s (required by 1080p; user did not pass --duration, see validation rule #2 case (a))

Validation: PASSED (2 warnings)
  ⚠ Audio is on but prompt has no Audio Layer descriptors — consider adding dialogue/SFX/ambient
  ⚠ Use case "hero-background" but audio=on — sure?

Cost estimate: ~$X.XX (Veo 3.1 quality, 8s, 1080p, audio)
Generation time: 2-4 minutes

Shall I generate?
```
````

### Task 9.4 — Add a Model decision table

Insert the following table into SKILL.md (reconstructed deterministically from `MODEL_SUGGESTIONS` in M1 Task 1.3). One row per use case; columns are quality / fast / lite (em-dash where omitted):

```markdown
### Model decision table

| Use case          | Quality                  | Fast                          | Lite                            |
|-------------------|--------------------------|-------------------------------|---------------------------------|
| hero-background   | veo-3.1-generate-001     | veo-3.1-fast-generate-001     | veo-3.1-lite-generate-001       |
| ambient           | veo-3.1-generate-001     | veo-3.1-fast-generate-001     | veo-3.1-lite-generate-001       |
| loop              | veo-3.1-generate-001     | veo-3.1-fast-generate-001     | veo-3.1-lite-generate-001       |
| social            | veo-3.1-generate-001     | veo-3.1-fast-generate-001     | —                               |
| marketing         | veo-3.1-generate-001     | veo-3.1-fast-generate-001     | —                               |
| product           | veo-3.1-generate-001     | veo-3.1-fast-generate-001     | —                               |
| storytelling      | veo-3.1-generate-001     | veo-3.1-fast-generate-001     | —                               |

Unknown use case → falls back to `{ quality: resolveDefaultModel(), fast: 'veo-3.1-fast-generate-001' }` (no `lite`).
```

### Task 9.5 — Strengthen Phase 1 audio derivation (deterministic `--no-audio`)

The use-case-defaults table from Task 9.2 is passive. Spec §2 (lines 558–575) and manual integration item #1 require that picking `hero-background` in `/veo` deterministically yields audio **off** — the library default is `true` for any Veo 3.x model, so the OFF behavior must come from an explicit Phase 1 instruction, not conversational luck. Add this directive immediately below the use-case-defaults table inserted in Task 9.2:

```markdown
### Phase 1 — deriving the audio flag (deterministic)

When the USE CASE is known, look up its audio default in the table above:

- If it resolves to **off** (`hero-background`, `ambient`, `loop`), you MUST pass `--no-audio` on the generated command line — the library default is `on` for every Veo 3.x model and will NOT turn audio off for you.
- If it resolves to **on**, pass nothing (the library default already produces audio) or `--audio` to be explicit.
- An explicit user request for audio on/off always wins over the use-case default; pass the matching `--audio` / `--no-audio` flag.

Example — hero-background:
`veo-generate --prompt "..." --output out.mp4 --no-audio`   ← audio OFF, derived from use case
```

### Task 9.6 — Phase 2 CRAFT: 6-element formula + negativePrompt auto-suggestion

Spec §4 Phase 2 (line 781) + §2 audio prompting (lines 577–588). The current Phase 2 has no Audio Layer element and no negativePrompt auto-suggestion. Append to the Phase 2 CRAFT section:

````markdown
### Audio Layer — the 6th element (when audio is on)

When audio is on, extend the 5-Element Formula to 6:

```
[Cinematography] + [Subject] + [Action] + [Context] + [Style & Ambiance] + [Audio Layer]
```

Audio Layer = at least one of: **Dialogue** (always quoted, e.g. `a narrator says: "the future arrives in silence"`), **SFX** (`metallic click, shattering glass`), or **Ambient** (`wind through pines, distant ocean echo`). See `references/audio-lexicon.md`.

### Auto-suggest a negative prompt

For `hero-background`, `ambient`, and `loop` use cases, proactively suggest a negative prompt to keep the frame clean for overlaid UI/text:

> Suggested `--negative-prompt "text overlays, logos, watermarks"`

Confirm with the user before applying. **Guidance**: phrase negative prompts as a *list of unwanted elements* (`"text, logos"`), NOT as imperatives (`"no text"`, `"don't show logos"`) — the API treats them as a list, not instructions.
````

### Task 9.7 — Phase 3 VALIDATE: reference softened rules + invoke validateConfig()

Spec §4 Phase 3 (lines 783–787). The fourth bullet ("invoke `validateConfig()` for hard API constraint violations") has no SKILL.md home. Replace the Phase 3 VALIDATE body with:

```markdown
## Phase 3 — VALIDATE

Prompt-quality checks (see `validation/prompt-checklist.md`, softened in this release):
- Text/UI in frame → warning only when text is meant to be visible in frame (quoted dialogue is natively supported).
- Single camera movement → reject for `loop` / `hero-background` only; warning otherwise.
- `audio=on` without an Audio Layer descriptor → warning.

Hard API-constraint check (NEW): before presenting, run the library validator on the resolved config — invoke `veo-generate --dry-run` (which calls `validateConfig()` internally). `validateConfig()` never throws; it returns auto-fixes (e.g. duration bumped to 8 for 1080p/4K), warnings, or hard errors (e.g. duration not allowed for the model, Veo 2 + audio, 1080p on Veo 2, outputPath/storageUri XOR). Surface its auto-adjustments and warnings in Phase 4 PRESENT; if it returns errors, fix the config and re-run before presenting.
```

### Task 9.8 — Phase 4 PRESENT: cost comes from estimateCost()

Spec §4 Phase 4 (line 789) + pricing maintenance (line 875): the cost line MUST come from `estimateCost()`. The PRESENT block from Task 9.3 uses a literal `~$X.XX` template. Add this note immediately after the PRESENT block:

```markdown
> The `Cost estimate: ~$X.XX` line is a template. Produce the real value by running
> `veo-generate --dry-run` on the resolved config — its `estimated cost:` line is computed
> by `estimateCost(v.autoFixed)` and already includes the breakdown
> (model, duration, resolution, audio, sampleCount multiplier). Substitute that number
> for `~$X.XX`. Never hand-estimate the cost. The CLI `--dry-run` output is the abbreviated
> machine form; the PRESENT block above is the conversational form — they carry the same
> resolved settings, auto-adjustments, warnings, and the same estimateCost() number.
```

### Task 9.9 — New parameters section (every cross-cutting flag with an example)

Spec success criterion (line 1022) + migration step 10 (line 1007) + M9 goal: SKILL.md must document **every** new parameter with at least one example. Add a top-level section:

````markdown
## New parameters (Foundation)

Every cross-cutting flag, with one example each:

| Flag | Example |
|---|---|
| `--negative-prompt` | `--negative-prompt "text overlays, logos, watermarks"` (list of unwanted elements, not imperatives like "no text") |
| `--enhance-prompt` / `--no-enhance-prompt` | `--no-enhance-prompt` (power users disable Google's internal rewrite for tighter control) |
| `--storage-uri` | `--storage-uri gs://my-bucket/out/` (server-side delivery; mutually exclusive with `--output`) |
| `--person-generation` | `--person-generation allow_adult` (`allow_all` \| `allow_adult` \| `disallow`; EU/UK/CH/MENA auto-downgrade `allow_all`→`allow_adult`) |
| `--seed` | `--seed 12345` (integer 0–2147483647 = 2^31−1; determinism is best-effort on Veo 3) |
| `--resolution 4k` | `--resolution 4k` (requires `--duration 8`; not available on Veo 2) |
| `--add-watermark` / `--no-add-watermark` | `--no-add-watermark` (SynthID watermark is on by default on Vertex; disable only for internal QA) |
| `--include-rai-reason` | `--include-rai-reason` (include the Responsible-AI block reason in the error response for debugging safety rejections) |
````

```bash
git add skills/veo/SKILL.md
git commit -m "docs(M9/SKILL.md): 7-value USE CASE enum + context-aware audio + PRESENT format + model table + Phase 2/3/5/6 + new-params section"
```

### Task 9.10 — Phase 5 GENERATE: enriched error handling

Spec §4 Phase 5 (lines 817–821). The current Phase 5 just runs the script and reports the path. Replace the Phase 5 GENERATE section with:

```markdown
## Phase 5 — GENERATE

Run `veo-generate` with the resolved flags. Then map the result to one of these outcomes:

- **Safety filter** (`raiMediaFilteredCount > 0`): report `Safety filter triggered: <reason>` (the reason comes from the RAI response when `--include-rai-reason` was set) and suggest an edited prompt.
- **Audio blocked, no charge**: report `Audio rejected, no charge applied, video saved without audio` — the video is usable; only the audio track was filtered.
- **Quota exceeded**: report the quota error and suggest switching to a Fast variant (`--model veo-3.1-fast-generate-001`) to retry.
- **Region restriction**: person-generation downgrades are pre-applied in Phase 4; if the user forced an explicit `--person-generation allow_all` in a restricted region, the API rejects it — report the failure with the clear region message and the `allow_adult` alternative.
- **Success**: report the saved video path (or the `gs://` URI when `--storage-uri` was used).
```

```bash
git add skills/veo/SKILL.md
git commit -m "docs(M9/SKILL.md): Phase 5 GENERATE enriched error handling (rai filter / audio-blocked / quota / region)"
```

### Task 9.11 — Phase 6 ITERATE: new diagnostic rows

Spec §4 Phase 6 (lines 823–829). Append these four rows to the Phase 6 ITERATE diagnostic table (keep the existing rows):

```markdown
| Poor audio sync | More specific Audio Layer; short dialogue (~5 words) |
| Cost too high | Switch to Fast or Lite; try 720p |
| Output too generic | Disable `enhancePrompt` (`--no-enhance-prompt`); tighten the prompt |
| Region blocks persons | Set `--person-generation allow_adult` explicitly |
```

```bash
git add skills/veo/SKILL.md
git commit -m "docs(M9/SKILL.md): Phase 6 ITERATE new diagnostic rows (audio sync / cost / generic output / region)"
```

### Milestone Gate M9

```bash
# 7-value USE CASE enum present
grep -E "hero-background|marketing|social|product|ambient|loop|storytelling" skills/veo/SKILL.md | wc -l   # >= 7
# PRESENT block
grep -q "READY FOR REVIEW" skills/veo/SKILL.md
# Phase 1 deterministic audio derivation
grep -q -- "--no-audio" skills/veo/SKILL.md
# Phase 2 CRAFT: 6th element + negativePrompt auto-suggestion
grep -q "Audio Layer" skills/veo/SKILL.md
grep -q "negative-prompt\|negativePrompt" skills/veo/SKILL.md
# Phase 3 VALIDATE: validateConfig / dry-run invocation
grep -Eq "validateConfig|--dry-run" skills/veo/SKILL.md
# Phase 4 cost from estimateCost()
grep -q "estimateCost" skills/veo/SKILL.md
# Phase 5 GENERATE error branches
grep -q "Safety filter triggered" skills/veo/SKILL.md
grep -q "no charge" skills/veo/SKILL.md
# Phase 6 ITERATE new rows
grep -q "Poor audio sync" skills/veo/SKILL.md
grep -q "Cost too high" skills/veo/SKILL.md
# New parameters section documents every cross-cutting flag
for f in -- --enhance-prompt --storage-uri --person-generation --seed --add-watermark --include-rai-reason; do
  grep -q -- "$f" skills/veo/SKILL.md || echo "MISSING flag doc: $f"
done
grep -q "4k" skills/veo/SKILL.md
```

Expected: enum count ≥ 7; every `grep -q` succeeds (no `MISSING flag doc:` output); the four-phase rewrites and new-params section all present.

---

## M10 — `audio-lexicon.md`, examples, `prompt-checklist.md` softening

**Goal**: Land the new audio-lexicon reference, audio prompt examples, and soften prompt-checklist.md per the spec (reject → warning where the constraint is no longer absolute).

**Dependencies**: M9.

**Gate**: `skills/veo/references/audio-lexicon.md` exists; `skills/veo/examples/` contains at least one audio-on prompt example; `prompt-checklist.md` no longer has the five hard REJECTs softened in Task 10.3 (text-in-frame, multi-camera movement, dialogue-without-quotes, audio-without-descriptors, onomatopoeia).

### Task 10.1 — Create `audio-lexicon.md`

`/home/giuseppe/claude/veo-tools/skills/veo/references/audio-lexicon.md`:

```markdown
# Veo Audio Lexicon

Reference vocabulary for writing prompts that produce coherent audio tracks on Veo 3.x. Veo 2 has no audio.

## SFX vocabulary (Foley-style)
- footsteps on gravel, leaves, marble
- distant traffic, wind in trees, ocean swell
- fabric rustle, fingers on keyboard, pages turning

## Dialogue patterns for ~8s
- one short line (≤ 8 words) per visible speaker
- avoid voice-over without an on-screen mouth in frame at second ≥ 1
- known limit: voice does not extend beyond the last second of frame — write the line to end before the 7s mark

## Ambient patterns by mood
- calm:   gentle wind, distant water, soft string drone
- tense:  low rumble, intermittent metallic creak
- joyful: distant laughter, warm room tone, ascending chimes
- urgent: heartbeat, rapid breathing, ticking

## Anti-patterns
- "BAM!", "WHOOSH" — onomatopoeia is captioned, not vocalized. Use Foley descriptors instead.
- multi-character overlapping dialogue — Veo prioritizes the first speaker.
```

Assert the file landed with the expected anchor section:

```bash
test -f skills/veo/references/audio-lexicon.md && grep -q "SFX vocabulary" skills/veo/references/audio-lexicon.md
```

```bash
mkdir -p skills/veo/references
git add skills/veo/references/audio-lexicon.md
git commit -m "docs(M10): add audio-lexicon.md (SFX/Foley + dialogue + ambient patterns)"
```

### Task 10.2 — Audio prompt examples

`/home/giuseppe/claude/veo-tools/skills/veo/examples/audio-on.md`:

```markdown
# Audio-on prompt examples

## Marketing (audio on by default)
> "Close-up of an espresso machine pulling a shot, steam rising. SFX: low pump hum, soft hiss of steam, cup chinks against saucer. Warm Italian café ambience."

## Social (audio on by default)
> "Dog catches frisbee mid-air at the park. SFX: faint child laughter, dog's quick exhale, frisbee whoosh on catch."

## Storytelling (audio on by default; one-line dialogue)
> "Old man on porch at dusk, sipping coffee. He says quietly: 'Storm's coming.' Wind picks up in trees. Distant thunder."
```

```bash
mkdir -p skills/veo/examples
git add skills/veo/examples/audio-on.md
git commit -m "docs(M10): add audio-on prompt examples for marketing/social/storytelling"
```

### Task 10.3 — Soften `prompt-checklist.md`

First, read the current content to identify the exact paragraphs to rewrite:

```bash
cat skills/veo/validation/prompt-checklist.md
```

Locate each `REJECT:` heading (or paragraph) below in the file. For each one, use the Edit tool with the **full paragraph(s)** under that heading as the `old_string` (do NOT use the short labels — they will not be unique). Replace with the corresponding NEW block:

**1. Text/UI elements** — find the section currently led by `REJECT: Text/UI element requests` (or equivalent wording) and replace its leading directive paragraph with:

```markdown
WARNING (only when text appears visible in frame): Text/UI element requests are unreliable. Prefer in-camera signage (carved, printed, projected) so the model renders it as part of the scene rather than as captions.
```

**2. Multiple camera movements** — find the section led by `REJECT: Multiple Camera Movements` and replace its leading directive paragraph with:

```markdown
REJECT for `loop` / `hero-background` use cases (smoother loops with a single motion). WARNING otherwise — marketing/storytelling can use composed movements when justified.
```

**3. Dialogue without quotes** — find the section led by `REJECT: Dialogue without quotes` and replace its leading directive paragraph with:

```markdown
WARNING: Dialogue without quotation marks may be skipped or mistranscribed. Wrap spoken lines in double quotes — e.g., `"Storm's coming."`
```

**4. Audio on without descriptors** — find the section led by `REJECT: audio=on without Audio Layer descriptors` and replace its leading directive paragraph with:

```markdown
WARNING: `audio=on` without explicit Audio / SFX / Ambient descriptors in the prompt falls back to generic ambience. Add descriptors (see `references/audio-lexicon.md`) for predictable tracks.
```

**5. Onomatopoeia** — find the section led by `REJECT: Comic-book onomatopoeia (BAM, WHOOSH)` and replace its leading directive paragraph with:

```markdown
SOFT WARNING: Comic-book onomatopoeia (BAM, WHOOSH) produces on-screen captions, not sound. Swap for Foley-style descriptors — see `references/audio-lexicon.md`.
```

After all five Edit calls succeed, verify:

```bash
grep -c "^REJECT:" skills/veo/validation/prompt-checklist.md   # expect: only the loop/hero exception line for #2 (or 0 if it was reworded)
grep -c "WARNING" skills/veo/validation/prompt-checklist.md    # expect: at least 5
```

```bash
git add skills/veo/validation/prompt-checklist.md
git commit -m "docs(M10): soften 5 obsolete prompt-checklist REJECTs to warnings"
```

### Milestone Gate M10

```bash
ls skills/veo/references/audio-lexicon.md
ls skills/veo/examples/audio-on.md
grep -c "WARNING" skills/veo/validation/prompt-checklist.md
```

Expected: both files exist; WARNING count > previous REJECT count.

---

## M11 — HUMAN GATE: SemVer freeze decision

> **HUMAN GATE — STOP HERE**
>
> Before bumping `plugin.json` 1.0.0 → 2.0.0, ask the user explicitly:
>
> > "Confirm SemVer 2.0.0 bump? The two breaking changes are: (1) `generateVideo(config, outputPath)` → `generateVideo(config)` source-breaking signature change; (2) audio default off → context-aware (on when use case unspecified). Both are documented in CHANGELOG (M12). SemVer 2.0.0 §8 requires MAJOR for incompatible API changes regardless of mitigation."
>
> Do **not** auto-bump. Wait for an explicit "yes, 2.0.0" from the user.

When confirmed, proceed to M12. If the user requests a different bump (e.g., "let's call it 1.1.0 and document the breakage as a known issue"), STOP and re-plan — the rest of M12+ assumes 2.0.0.

---

## M12 — `CHANGELOG.md` + `plugin.json` bump

**Goal**: Document incompatible changes + bump version. Single commit each.

**Dependencies**: M11 confirmation.

**Gate**: `.claude-plugin/plugin.json` reads `"version": "2.0.0"`. CHANGELOG present at repo root.

### Task 12.1 — Create `CHANGELOG.md`

`/home/giuseppe/claude/veo-tools/CHANGELOG.md`:

```markdown
# Changelog

All notable changes to `veo-tools` are documented here. Format: [Keep a Changelog](https://keepachangelog.com/). SemVer.

## [2.0.0] — 2026-06-16

### BREAKING
- **`generateVideo` signature change**: was `generateVideo(config, outputPath)`, now `generateVideo(config)` with `outputPath` (or `storageUri`) living inside `VeoConfig`. Validation rule #9 enforces exactly one of the two.
- **Audio default change**: was `generateAudio: false` by default, now context-aware. When Phase 1 USE CASE is `hero-background`, `ambient`, or `loop`, audio defaults to off; for `social`, `marketing`, `product`, `storytelling`, or unspecified use case, audio defaults to on (matching Veo 3.1 API native default). Restore the previous behaviour with `--no-audio`.

### Added
- `skills/_shared/veo-core/` shared library (types, constants, auth, image-helpers, pricing, api, validation, generate, bootstrap).
- 7-value Phase 1 USE CASE enum: `hero-background | marketing | social | product | ambient | loop | storytelling` (added `loop` and `storytelling`).
- Cross-cutting parameters and CLI flags: `--negative-prompt`, `--enhance-prompt` / `--no-enhance-prompt`, `--seed`, `--sample-count`, `--person-generation`, `--storage-uri`, `--add-watermark` / `--no-add-watermark`, `--include-rai-reason`.
- `FOUNDATION_RULES` + `createValidator({baseRules, extraRules})` factory.
- `estimateCost(config)` keyed by model × resolution × duration × audio × sampleCount, with dated-header audit trail in `pricing.ts`.
- `audio-lexicon.md` reference.
- 4K resolution support (Veo 3.x).
- `addWatermark` and `includeRaiReason` pass-through parameters (Vertex AI defaults preserved).
- CI workflow (`npm ci && npm test`) on PRs to `main`.

### Changed
- Auth: `google-auth-library` replaces `gcloud auth print-access-token` shell-out.
- `prompt-checklist.md`: four obsolete REJECTs softened to WARNINGs (text-in-frame, multi-camera movement, dialogue without quotes, audio without descriptors, onomatopoeia).
- `downloadFile` hardened: redirect cap 10, dual timeouts (30s socket / 15min total), cross-origin Authorization stripping per RFC 6454, HTTPS→HTTP redirects rejected outright, atomic temp-file write, 1 KB error-body cap.
- `validateConfig` never throws; returns a discriminated `ValidationResult` union.

### Removed
- Direct `gcloud` CLI dependency.

## [1.0.0] — 2025-05-23

Initial release.
```

```bash
git add CHANGELOG.md
git commit -m "docs(M12): add CHANGELOG.md documenting the two breaking changes for 2.0.0"
```

### Task 12.2 — Bump `plugin.json`

Edit `/home/giuseppe/claude/veo-tools/.claude-plugin/plugin.json`:

```json
{
  "name": "veo-tools",
  "description": "AI video generation skills for Google Veo 3 - generate cinematic videos, configure GCP, and create seamless loops",
  "version": "2.0.0"
}
```

```bash
git add .claude-plugin/plugin.json
git commit -m "chore(M12): bump plugin.json 1.0.0 -> 2.0.0 (SemVer major for incompatible API changes)"
```

### Milestone Gate M12

```bash
grep '"version"' .claude-plugin/plugin.json
grep -c "BREAKING" CHANGELOG.md
```

Expected: `"version": "2.0.0"`; BREAKING count >= 1.

---

## M13 — HUMAN GATE: Probe pass (PAID, ~$17.50)

> **HUMAN GATE — STOP HERE**
>
> The next step costs real money on the user's GCP project. Before running, confirm with the user:
>
> > "About to run the M13 probe pass: ~7 paid Veo generations × ~$2.50 each ≈ ~$17.50 charged to the active GCP project. This verifies (a) every `AVAILABLE_MODELS` entry still responds with 200, (b) the `enhancePrompt` REST parameter name, (c) the `referenceImages` `{referenceType: 'asset', image}` wrap shape on veo-3.1-generate-001, and (d) the PROVISIONAL `MODEL_SAMPLE_MAX['veo-3.1-lite-generate-001'] = 4` Preview-tier ceiling. Confirm GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION are set to the intended project. Proceed?"
>
> Wait for explicit "yes" + project/location confirmation.

**Action-on-failure clause** (record outcomes in `CHANGELOG.md` "Resolved decisions" if relevant):
- 404 / "model not found" / "deprecated" → remove the model from `AVAILABLE_MODELS` AND `DEFAULT_MODEL_CHAIN` (if present). Add a Resolved-decisions entry: removal date + reason.
- Veo 3.0 family (`veo-3.0-generate-001`, `veo-3.0-fast-generate-001`) has an announced discontinuation date of **30 Jun 2026**. If today's date is ≥ 30 Jun 2026, expect failure and remove proactively *before* running the probe.
- Lite `sampleCount=4` rejection → lower the entry in `MODEL_SAMPLE_MAX` to the value the API accepts, drop the `// PROVISIONAL` comment, and document the decision.

### Task 13.1 — Pre-flight (free)

```bash
# Confirm env
echo "PROJECT=$GOOGLE_CLOUD_PROJECT  LOCATION=${GOOGLE_CLOUD_LOCATION:-us-central1}"
ts-node skills/veo/scripts/veo-generate.ts --dry-run --prompt "test probe" --output /tmp/probe.mp4
```

### Task 13.2 — Probe each model (paid)

For each id in `AVAILABLE_MODELS`, run the minimal command and record results:

```bash
for model in veo-3.1-generate-001 veo-3.1-fast-generate-001 veo-3.1-lite-generate-001 veo-3.0-generate-001 veo-3.0-fast-generate-001 veo-2.0-generate-001; do
  echo "=== $model ==="
  outpath="/tmp/probe-${model}.mp4"
  if [ "$model" = "veo-2.0-generate-001" ]; then
    ts-node skills/veo/scripts/veo-generate.ts --prompt "a sunset over the sea" --model "$model" --output "$outpath" --no-audio --resolution 720p --duration 8 || echo "FAILED: $model"
  else
    ts-node skills/veo/scripts/veo-generate.ts --prompt "a sunset over the sea" --model "$model" --output "$outpath" --duration 4 || echo "FAILED: $model"
  fi
done
```

### Task 13.3 — Probe Lite sampleCount=4 (paid)

```bash
ts-node skills/veo/scripts/veo-generate.ts --prompt "a leaf falling" --model veo-3.1-lite-generate-001 --output /tmp/lite-sc4.mp4 --sample-count 4 --duration 4 || echo "Lite sampleCount=4 rejected — update MODEL_SAMPLE_MAX"
```

### Task 13.4 — Probe enhancePrompt + referenceImages shape (paid; on veo-3.1-generate-001)

```bash
# enhancePrompt off vs on (counts as 2 of the 7 in the budget)
ts-node skills/veo/scripts/veo-generate.ts --prompt "a leaf falling" --no-enhance-prompt --output /tmp/eh-off.mp4 --duration 4
ts-node skills/veo/scripts/veo-generate.ts --prompt "a leaf falling" --enhance-prompt    --output /tmp/eh-on.mp4  --duration 4
```

`referenceImages` requires a future sub-project (/veo-multi-shot v2) to exercise on the wire — record that the request body is built correctly via the M4 `api.test.ts` shape assertion, defer the actual paid wire test to that sub-project.

### Task 13.5 — Record findings

If any model failed, edit `constants.ts` (remove from `AVAILABLE_MODELS` + `DEFAULT_MODEL_CHAIN` if present) and amend `CHANGELOG.md` with a Resolved-decisions block dated today, then:

```bash
git add skills/_shared/veo-core/constants.ts CHANGELOG.md
git commit -m "chore(M13): record probe-pass outcomes (model removals / Lite ceiling)"
```

Otherwise, write a single line confirming all 6 models green to the PR description.

### Milestone Gate M13

- Each probed model either generated a video OR is removed from `AVAILABLE_MODELS` with a Resolved-decisions entry.
- Lite `sampleCount=4` outcome recorded (kept as 4, or lowered + comment updated).
- Estimated spend ≤ $17.50 confirmed in the GCP billing console.

---

## M14 — PR creation

**Goal**: Open PR #3 against `main`. Embed the 9-item manual checklist with checkmarks/links. Note PR #1 (the spec) is independent.

**Dependencies**: M0–M13.

**Gate**: PR opens cleanly on GitHub; CI green; checklist visible in description.

### Task 14.1 — Run the 9-item integration checklist

Each item below is one paid generation except 8b (no-cost). Record success + a viewable link (local file path or shared GCS link) for each:

1. Default hero background via SKILL.md — `--prompt "..." ` after Phase 1 elicits use-case=hero-background; expect audio off, 720p, duration=4.
2. Default bare CLI — `--prompt "x" --output /tmp/2.mp4` → expect 8s / 720p / audio on.
3. Marketing with audio on — `--prompt "espresso machine pulling a shot, SFX..." --output /tmp/3.mp4`.
4. 1080p forces duration=8 — `--prompt "x" --output /tmp/4.mp4 --resolution 1080p` (no `--duration`).
5. 4K + 8s — `--prompt "x" --output /tmp/5.mp4 --resolution 4k --duration 8`.
6. negativePrompt — `--prompt "city street" --negative-prompt "cars" --output /tmp/6.mp4`.
7. enhancePrompt diff — `/tmp/7a.mp4 --no-enhance-prompt` vs `/tmp/7b.mp4 --enhance-prompt`.
8a. Veo 2 auto-fix audio — `--model veo-2.0-generate-001 --prompt "x" --output /tmp/8a.mp4`; expect `autoFixMessages` mentions "Veo 2 doesn't support audio".
8b. Veo 2 explicit audio hard error — `--model veo-2.0-generate-001 --audio --prompt "x" --output /tmp/8b.mp4`; expect non-zero exit + error string, NO API call. (No charge.)
9. Lite generates — `--model veo-3.1-lite-generate-001 --prompt "x" --output /tmp/9.mp4 --duration 4`; record cost.

### Task 14.1a — Write `docs/foundation-release-checklist.md`

Create the literal file (same wording as the PR body in 14.2, so reviewers tick the same items from either surface):

`/home/giuseppe/claude/veo-tools/docs/foundation-release-checklist.md`:

````markdown
# Veo Foundation 2.0.0 — Release integration checklist

Run once before merging PR #3. 10 line items total: 9 paid (items 1, 2, 3, 4, 5, 6, 7, 8a, 9) and 1 no-cost (8b). Estimated spend: ~$22.50 (covers M13 probe pass + this checklist; reuse outputs where possible).

For each paid item, record (a) the generated mp4 path or shared GCS link and (b) the resolved settings as they appeared in the Phase 4 PRESENT log.

- [ ] **1. Default hero background via SKILL.md** — Phase 1 elicits use case `hero-background`; expect audio off, 720p, duration=4. Link: `<path>`
- [ ] **2. Default bare CLI** — `--prompt "x" --output /tmp/2.mp4`; expect 8s / 720p / audio on. Link: `<path>`
- [ ] **3. Marketing with audio on** — `--prompt "espresso machine pulling a shot, SFX..." --output /tmp/3.mp4`. Link: `<path>`
- [ ] **4. 1080p forces duration=8** — `--prompt "x" --output /tmp/4.mp4 --resolution 1080p` (no `--duration`); expect auto-fix line in PRESENT log. Link: `<path>`
- [ ] **5. 4K + 8s** — `--prompt "x" --output /tmp/5.mp4 --resolution 4k --duration 8`. Link: `<path>`
- [ ] **6. negativePrompt** — `--prompt "city street" --negative-prompt "cars" --output /tmp/6.mp4`. Link: `<path>`
- [ ] **7. enhancePrompt diff** — `/tmp/7a.mp4 --no-enhance-prompt` vs `/tmp/7b.mp4 --enhance-prompt`. Links: 7a `<path>`, 7b `<path>`
- [ ] **8a. Veo 2 auto-fix audio** — `--model veo-2.0-generate-001 --prompt "x" --output /tmp/8a.mp4`; expect `autoFixMessages` mentions "Veo 2 doesn't support audio". Link: `<path>`
- [ ] **8b. Veo 2 explicit audio → hard error (NO charge)** — `--model veo-2.0-generate-001 --audio --prompt "x" --output /tmp/8b.mp4`; expect non-zero exit + error string, no API call.
- [ ] **9. Lite generates** — `--model veo-3.1-lite-generate-001 --prompt "x" --output /tmp/9.mp4 --duration 4`; record cost. Link: `<path>`

`<path>` placeholders stay literal at file-creation time and are filled in by reviewers as each item completes. M13 probe outputs at `/tmp/probe-*.mp4` may satisfy some rows (e.g., #9 reuses the Lite probe).
````

```bash
mkdir -p docs
git add docs/foundation-release-checklist.md
git commit -m "docs(M14): add foundation-release-checklist.md (10 items; 9 paid + 1 no-cost)"
```

### Task 14.2 — Push + create PR

`<path>` placeholders in the PR body are intentionally left unfilled when the PR opens; reviewers fill them in as each manual integration item completes (see M13 outputs at `/tmp/probe-*.mp4` and Task 14.1's per-item outputs at `/tmp/N.mp4`).

```bash
git push -u origin feat/veo-foundation-impl
gh pr create --base main --title "feat: Veo Foundation implementation (2.0.0)" --body "$(cat <<'EOF'
## Summary
- Lands `skills/_shared/veo-core/` (auth, api, generate, validation, pricing, types, constants, image-helpers, bootstrap).
- Refactors `veo-generate.ts` and `veo-multi-generate.ts` to thin CLIs over the shared library.
- 7-value USE CASE enum, context-aware audio default, 4K support, new cross-cutting CLI flags.
- SemVer major bump 1.0.0 → 2.0.0 (two breaking changes documented in CHANGELOG).

Spec PR (independent track): #1.

## Manual integration checklist (9 items; 9 paid + 1 no-cost)

- [ ] 1. Default hero background via SKILL.md → audio off, 720p, duration=4. Link: <path>
- [ ] 2. Default bare CLI → 8s / 720p / audio on. Link: <path>
- [ ] 3. Marketing with audio on → SFX present. Link: <path>
- [ ] 4. 1080p forces duration=8 → auto-fix in PRESENT log. Link: <path>
- [ ] 5. 4K + 8s succeeds. Link: <path>
- [ ] 6. negativePrompt excludes target. Link: <path>
- [ ] 7. enhancePrompt diff visible. Links: 7a <path>, 7b <path>
- [ ] 8a. Veo 2 auto-fix audio=false. Link: <path>
- [ ] 8b. Veo 2 explicit --audio → hard error, no API call.
- [ ] 9. Lite generates at lower cost. Link: <path>

## Test plan
- [x] `npm ci && npm test` green in CI
- [ ] Manual checklist above signed off
- [ ] M13 probe pass outcome recorded (all 6 models green, or removals documented)
EOF
)"
```

### Milestone Gate M14

- PR open against `main`.
- CI green.
- Checklist visible in PR body.
- Wait for reviewer sign-off + manual checkmarks before merge.

---

## Self-review checklist (writer's own)

Before declaring the plan ready:

- [ ] Every milestone has Goal / Dependencies / Gate / Tasks sections.
- [ ] M0 ends with a sanity test proving the `@veo-core/*` alias resolves.
- [ ] No code step says "implement X" without showing the code; non-trivial code (`bootstrap.ts`, `downloadFile`, `validation.ts`, `generate.ts`) is fully literal. M9 SKILL.md edits inline the use-case-defaults table, the literal PRESENT block (quoted verbatim from spec PR #1 §4), and the model decision table (reconstructed from `MODEL_SUGGESTIONS`).
- [ ] M11 and M13 are explicitly marked as HUMAN GATES; the plan does not auto-bump version or auto-spend money.
- [ ] Probe budget visible (~$17.50) and Action-on-failure documented.
- [ ] Every task ends with explicit `git add` + `git commit -m "<tag>(<milestone>/<area>): <verb> <object>"`.
- [ ] No `--no-verify`, no `--amend`, no `--force` anywhere.
- [ ] SemVer 2.0.0 reasoning cited (signature change + audio default change).
- [ ] Forward-declared fields (`image`, `lastFrame`, `referenceImages`, `videoExtensionInput`) typed in M1 even though Foundation does not validate the first three; rule #10 emits the forward-compat warning for `videoExtensionInput`.
- [ ] Rules-guard-against-undefined contract enforced by the rule bodies in M5; rule #9 is the sole undefined-guard exception (checks both `outputPath` and `storageUri`).
- [ ] `validateConfig` is exported as `createValidator({ baseRules: FOUNDATION_RULES })` — not a separate function — so it inherits the try/catch wrapper.
- [ ] PR opens against `main`, not against the spec branch.
