# Veo Foundation — Design Spec

**Date**: 2026-05-23
**Status**: Proposed (under review)
**Scope**: Foundation sub-project (1 of 5 in the Veo improvements roadmap)
**Authors**: Giuseppe Iuculano + Claude

---

## Context

The `veo-tools` plugin currently exposes a 6-phase workflow for Google Veo 3.1 via Vertex AI, with two skills (`/veo`, `/veo-multi-shot`) plus support skills (`/veo-setup`, `/video-loop`). An audit of the official Veo documentation (`ai.google.dev/gemini-api/docs/video`, Vertex AI Veo docs, and prompt guides) revealed significant gaps between the API's capabilities and the plugin's implementation:

- Missing input modalities: image-to-video, frame interpolation, video extension, reference images
- Missing API parameters: `negativePrompt`, `enhancePrompt`, `storageUri`, `personGeneration`
- Missing models: Veo 3.1 Lite, Veo 3 stable, Veo 2
- Missing resolution: 4K
- Audio native treated as second-class (default off, no prompt guidance) despite being a killer feature of Veo 3+
- No cross-parameter validation (e.g., 1080p requires duration=8)
- Code duplication between `veo-generate.ts` and `veo-multi-generate.ts` blocking new skills

The full roadmap (chosen Approach A — staged by capability) is decomposed into 5 sub-projects with the following execution order:

1. **Foundation** *(this spec)* — shared library + cross-cutting parameters + audio context-aware + validation + image input plumbing
2. **`/veo-animate`** — image-to-video (first frame). *In parallel with #3 after Foundation.*
3. **`/veo-interpolate`** — first frame + last frame. *In parallel with #2 after Foundation.*
4. **`/veo-multi-shot v2`** — `referenceImages` integration. *Parallel with #2/#3 after Foundation.*
5. **`/veo-extend`** — video extension up to ~148s. *Serialized after #2/#3* because its operation-chain semantics are the riskiest and benefit from stabilized image-input code (rationale from agent review).

Foundation is the enabling block: all four downstream sub-projects depend on the shared library, parameters, and image input plumbing defined here.

**Closed scope decisions (not in roadmap)**: Vertex AI "insert objects" / "remove objects" / upscaling are formally **out of roadmap**. Demand-gated future work, not a deferred sub-project. This is recorded here so planning doesn't carry ambiguity forward.

## Scope

### In scope

- Shared library `skills/_shared/veo-core/` with auth, API, validation, pricing, types
- Refactor `skills/veo/scripts/veo-generate.ts` and `skills/veo-multi-shot/scripts/veo-multi-generate.ts` as thin wrappers over the shared library
- Extend `/veo` with cross-cutting parameters: `negativePrompt`, `enhancePrompt`, `storageUri`, `personGeneration`, `seed` (documentation)
- Support additional models: Veo 3.1 Lite, Veo 3, Veo 3 Fast, Veo 2
- Support 4K resolution (with cross-parameter validation)
- Audio context-aware default derived from use case (Phase 1 UNDERSTAND)
- Cross-parameter validation rules in `validation.ts`
- Auto-corrections with explicit user notification in Phase 4 PRESENT
- Update `validation/prompt-checklist.md` to remove obsolete rules (e.g., text rejection now nuanced)
- New reference file `references/audio-lexicon.md`
- CHANGELOG.md (new file)
- **Shared image input plumbing** (`types.ts` defines `ImageInput`; `image-helpers.ts` does MIME validation, base64 encoding, optional GCS upload). Foundation ships these even though no Foundation parameter consumes them, because sub-projects `/veo-animate`, `/veo-interpolate`, and `/veo-multi-shot v2` all need them — and we want to avoid each sub-project reinventing the plumbing.

### Out of scope

- Direct Gemini API endpoint (`generativelanguage.googleapis.com`) — user explicitly excluded; remain on Vertex AI
- Image-to-video / video extension / interpolation / reference images workflows — separate sub-projects
- Insert/remove object editing operations — possible future stretch
- New `/veo-animate`, `/veo-extend`, `/veo-interpolate` skills — separate sub-projects
- Multi-shot v2 with `referenceImages` — separate sub-project
- Pricing API integration — pricing remains a manually-updated table; automated fetching is future work

## Goals & non-goals

**Goals**
- Zero regression on existing workflows: every prompt that works today must still work after Foundation.
- Foundation must reduce per-script line count substantially by extracting shared code (target: ~150 lines, accept up to ~200 if clarity demands; baseline 595 lines). The point is the refactor extracted the right concerns into `_shared/`, not hitting a specific number.
- New skills (`/veo-animate` etc.) must be implementable by writing only a CLI + workflow, not new auth/polling/validation code.
- Audio native becomes a first-class option when use case warrants it, never silently lost when use case warrants it.

**Non-goals**
- Multi-provider abstraction (no Veo-vs-other-model swap layer).
- Web UI or web API server.
- Automated cost optimization (e.g., auto-switch to Fast if budget exceeded).

## Architecture

### Directory layout

```
tsconfig.json                       # NEW root tsconfig — declares @veo-core/* path alias (see Architecture text)
vitest.config.ts                    # NEW root vitest config — mirrors tsconfig paths so tests resolve alias
package.json                        # NEW root package.json — deps for runtime (google-auth-library, @google-cloud/storage, tsconfig-paths) + dev (vitest, ts-node, typescript, @types/node)
.github/workflows/test.yml          # NEW CI workflow

skills/
  _shared/                          # NEW — non-skill code (no SKILL.md → loader skips it; underscore is defensive convention)
    veo-core/
      auth.ts                       # getAccessToken() — uses google-auth-library
      api.ts                        # makeRequest, downloadFile, polling
      generate.ts                   # generateVideo(config) — unified entry
      bootstrap.ts                  # registers tsconfig-paths with absolute REPO_ROOT — imported first by every entry script
      validation.ts                 # FOUNDATION_RULES, createValidator() factory
      pricing.ts                    # estimateCost(config) per model × resolution × duration × audio × sampleCount
      types.ts                      # VeoConfig, GenerationResult, ValidationResult, ImageInput, VertexImage
      image-helpers.ts              # MIME validation, base64 encoding, GCS upload helpers (used by future sub-projects)
      constants.ts                  # MODELS, REGIONS, MAX_TOKENS, MAX_REFERENCE_IMAGES, MODEL_DURATIONS
  veo/
    scripts/
      veo-generate.ts               # thin CLI wrapper (~150 lines target, was 595)
    SKILL.md                        # updated with new params + audio context-aware
    references/
      cinematography-lexicon.md     # existing
      audio-lexicon.md              # NEW
    validation/
      prompt-checklist.md           # updated (obsolete rules removed/softened)
    examples/                       # add audio prompt examples
  veo-multi-shot/
    scripts/
      veo-multi-generate.ts         # thin CLI wrapper using veo-core
    SKILL.md                        # minimal update (params pass-through)
```

The `_shared/` directory is excluded from skill discovery because it contains **no `SKILL.md`** — the Claude Code skill loader scans for `SKILL.md` files, not directory naming. The underscore prefix is a defensive convention (makes the intent visually obvious and avoids ambiguity with future loader rules), but the operative exclusion mechanism is the absence of `SKILL.md`. *To verify before implementation: confirm the current loader behavior in Claude Code; if loader rules ever change to scan by directory name, revisit.*

Consuming skills reference `_shared/` via the **`@veo-core/*` path alias**, configured in the **root `tsconfig.json`** (added to the repository root by migration step 1, alongside `package.json`, `vitest.config.ts`, and the CI workflow — see directory layout above). Resolution is handled by `tsconfig-paths`, registered **programmatically via a bootstrap file** rather than via `NODE_OPTIONS`. Example consumer: `import { generateVideo } from '@veo-core/generate'`.

#### Why bootstrap, not `NODE_OPTIONS`

An earlier draft proposed `NODE_OPTIONS="-r tsconfig-paths/register"` to register the path resolver. Two practical problems with that approach:

1. The existing scripts have a `#!/usr/bin/env npx ts-node` shebang. Shebangs do not expand environment variables, so direct invocation (`./veo-generate.ts`) would bypass `NODE_OPTIONS` and the alias would not resolve.
2. Even when `NODE_OPTIONS` is set, `tsconfig-paths` resolves `tsconfig.json` relative to the current working directory. A script invoked from `skills/veo/scripts/` would not find the root `tsconfig.json`.

The bootstrap file solves both problems by registering `tsconfig-paths` programmatically with an absolute path computed at startup:

```typescript
// skills/_shared/veo-core/bootstrap.ts
//
// MODULE SYSTEM: Foundation targets CommonJS (matching ts-node's default).
// `__dirname` is used directly. If the plugin migrates to ESM in the future,
// replace `__dirname` with:
//   import { fileURLToPath } from 'url'
//   const __filename = fileURLToPath(import.meta.url)
//   const __dirname = path.dirname(__filename)
// and update tsconfig.json `module` to `NodeNext` or similar.

import * as path from 'path'
import * as fs from 'fs'
import { register } from 'tsconfig-paths'

// Walk upward from this file looking for the plugin root.
// Marker: .claude-plugin/plugin.json — uniquely identifies the veo-tools
// plugin root, survives environments where .git is absent (CI source
// archives, container builds, npm pack installs), and disambiguates from
// any sub-package or vendored copy that has its own package.json.
// Robust against file relocation and future monorepo restructuring.
function findRepoRoot(start: string): string {
  let dir = start
  while (true) {
    if (fs.existsSync(path.join(dir, '.claude-plugin', 'plugin.json'))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (dir === parent) break       // hit filesystem root without finding marker
    dir = parent
  }
  throw new Error('bootstrap.ts could not locate plugin root (no .claude-plugin/plugin.json found) from ' + start)
}

const REPO_ROOT = findRepoRoot(__dirname)

register({
  baseUrl: REPO_ROOT,
  paths: {
    '@veo-core/*': ['skills/_shared/veo-core/*'],
  },
})
```

Every entry point (each `*-generate.ts` CLI, every test file using the alias) imports the bootstrap **as its first line**:

```typescript
#!/usr/bin/env npx ts-node
import '../../_shared/veo-core/bootstrap'   // first import — registers @veo-core/* alias
import { generateVideo } from '@veo-core/generate'   // alias now resolves
// ... rest of CLI
```

The first import uses a relative path because the alias isn't registered yet. From then on, all imports use the alias. Tests under `vitest` get the alias via `vitest.config.ts` `resolve.alias`, mirroring the bootstrap so test discovery works without importing the bootstrap manually.

Rationale for choosing aliases over relative imports: we are already adding root infrastructure (`package.json`, `vitest`, CI workflow) for the test runner. The marginal cost of also adding a root `tsconfig.json` + bootstrap file is small, and the four downstream sub-projects will each import from `_shared/` — relative paths like `../../_shared/veo-core/pricing` repeated across all of them are brittle and cluttered.

### Module boundaries

| Module | Public API | Internal |
|---|---|---|
| `auth.ts` | `getAccessToken(): Promise<string>` | **Uses `google-auth-library`** npm package (not shelled-out `gcloud` CLI). Supports Service Accounts, ADC, and Workload Identity natively. Removes dependency on gcloud CLI being installed in the execution context — important for CI/CD and containerized usage. The previous `gcloud auth print-access-token` call in `veo-generate.ts` is replaced. |
| `api.ts` | `submitGeneration(config, token): Promise<operationName>`, `pollOperation(opName, token): Promise<status>`, `downloadFile(target, path, token): Promise<void>` (where `target` is either an `https://…` URL or a `gs://…` URI) | URL building, request handling. `makeRequest` (internal) handles HTTPS API calls — does **not** follow redirects (the predict/poll endpoints are not expected to return 3xx). All HTTPS calls use an explicit **30-second per-request timeout** to avoid indefinite hangs. `downloadFile` accepts both `https://` (downloads via HTTPS, follows redirects manually with a **max-depth limit of 5**, validates non-2xx/3xx → throws with status + body, cleans up partial files on error) and `gs://` (downloads via `@google-cloud/storage` client — that library handles its own retries and timeouts). The Vertex AI Veo API can return either form in `status.videoUrl` depending on project configuration. |
| `generate.ts` | `generateVideo(config: VeoConfig): Promise<GenerationResult>` | orchestrates auth → validate → submit → poll → (download \| skip if `storageUri` set). Output destination is read from `config.outputPath` or `config.storageUri`; exactly one must be set, enforced by validation rule #9. |
| `validation.ts` | `validateConfig(config: VeoConfig): ValidationResult` — **return-only contract: never throws**. Caller inspects `result.valid` and decides action. | rule registry, auto-fix logic |
| `pricing.ts` | `estimateCost(config: VeoConfig): { usd: number; breakdown: string }` | lookup table, last-updated marker comment |
| `image-helpers.ts` | `validateImage(img: ImageInput): void` (throws on invalid MIME or unreachable file), `encodeImage(img: ImageInput): VertexImage`, `uploadImageToGcs(localPath: string, gcsUri: string): Promise<string>` | MIME sniffing, base64 encoding, file I/O, GCS API. `encodeImage` is the single public function used by `buildRequestBody`; the earlier `encodeImageBase64(path)` shape from prior drafts is dropped to keep the API surface unambiguous. |
| `types.ts` | exports type definitions only | — |
| `constants.ts` | exports frozen objects/arrays | — |

### Data flow

```
CLI (veo-generate.ts)
  └─> parseArgs → VeoConfig (fields left `undefined` when user did NOT pass the flag; outputPath / storageUri included)
        └─> generateVideo(config)
              ├─> validateConfig(config) → ValidationResult (never throws)
              │     ├─> if !result.valid: generateVideo throws with errors + suggestions
              │     └─> if result.valid: continue with result.autoFixed config (defaults applied + auto-corrections)
              ├─> getAccessToken()
              ├─> submitGeneration(config, token) → operationName
              ├─> pollOperation(operationName, token) → status
              └─> if config.storageUri:
              │     skip downloadFile — video already on GCS at storageUri
              │   else:
              │     downloadFile(status.videoUrl, config.outputPath, token)
              │       └─> if target.startsWith('gs://'):
              │             use @google-cloud/storage client to copy GCS object → local file
              │           else (https://):
              │             HTTPS request with 30s timeout; follow redirects (max 5);
              │             validate non-2xx/3xx → throw with status + body;
              │             cleanup partial file on error
        └─> GenerationResult (videoPath set when downloaded; gcsUri set when storageUri used)
```

**Option provenance**: the CLI parser leaves a field `undefined` in `VeoConfig` when the user did NOT pass the corresponding flag. Defaults are applied inside `validateConfig()` (not in the parser). This lets validation distinguish "user explicitly set duration=6" (treat as user intent, hard-error if it conflicts with 1080p) from "duration not set, defaulting to 8" (apply auto-fix silently). The `result.autoFixed` config carries the final resolved values.

**Internal ordering inside `validateConfig()`** (matters because rules #1, #3, #4, #7 read `config.model`):

1. **Resolve defaults first** — including calling `resolveDefaultModel()` if `config.model === undefined`. After this step, every field that has a default is set. **`resolveDefaultModel()` can throw** (e.g., `AVAILABLE_MODELS` is empty or misconfigured); `validateConfig()` wraps the call in try/catch and converts any exception into a `{valid: false, errors: [<message>], suggestions: ['Check constants.AVAILABLE_MODELS configuration']}` result. This preserves the never-throws contract of `validateConfig()` even when its dependencies fail.
2. **Run all rules** against the fully-defaulted config. Rules can safely assume `config.model` is a non-undefined string.
3. **Apply auto-fixes** for the auto-correctable cases (region, duration-implied-by-resolution, Veo 2 audio when undefined).
4. **Return** `{valid: true, autoFixed: <fully-resolved-config>, warnings, autoFixMessages}` or `{valid: false, errors, suggestions}`.

Without this ordering, an unset `config.model` would cause `MODEL_DURATIONS[config.model]` (rule #1) to return `undefined` and the rule would either crash or silently pass — both are bugs. The order above is invariant; tests should assert it.

**Output destination**: `outputPath` lives on `VeoConfig` (not as a second function argument). Rule #9 in `validation.ts` enforces that exactly one of `outputPath` or `storageUri` is set. This keeps the validator as the single source of truth for input shape and lets `generateVideo` have a one-argument signature.

When `storageUri` is set, `outputPath` is ignored and `GenerationResult.gcsUri` carries the final location; `videoPath` is `undefined`. When `storageUri` is unset, the inverse holds. The CLI errors out if neither is provided.

## Detailed design

### 1. Cross-cutting parameters added to `/veo`

| Parameter | Type | Valid values | Default | Notes |
|---|---|---|---|---|
| `negativePrompt` | string | free text | `undefined` | List excluded elements, e.g., `"text overlays, logos, watermarks"`. **Guidance** (not enforced): avoid imperative phrasing like "no X" or "don't show X" — the API treats negative prompts as a list of unwanted elements, not as instructions. |
| `enhancePrompt` | boolean | true / false | `true` | Google rewrites prompt internally; disable for power users |
| `storageUri` | string | `gs://bucket/path/` | `undefined` | If set, video stored on GCS instead of local download |
| `personGeneration` | enum | `allow_all` \| `allow_adult` \| `dont_allow` | model/region default | Regional restrictions apply (EU/UK/CH/MENA) |
| `seed` | integer | 0–2^31 | random | Already present; documentation notes determinism is best-effort on Veo 3 |
| `resolution` | enum | + `4k` added to existing `720p`, `1080p` | `720p` | 4K requires `duration=8` |
| `model` | enum | expanded list (see below) | `veo-3.1-generate-preview` (latest generation; falls back to `veo-3.0-generate-001` if unavailable — see selection rule below) | |

#### Model expansion

| Model ID | Variant | Use case | Audio | Max resolution |
|---|---|---|---|---|
| `veo-3.1-generate-preview` | Veo 3.1 quality (preview) | Default quality | yes | 4K |
| `veo-3.1-fast-generate-preview` | Veo 3.1 fast | Fast iteration | yes | 4K |
| `veo-3.1-lite-generate-preview` | Veo 3.1 lite | Lowest cost. Supports text-to-video (in scope here) and image-to-video (added by `/veo-animate`). No `referenceImages`, no video extension. | yes | 1080p |
| `veo-3.0-generate-001` | Veo 3 stable | Production with audio | yes | 4K |
| `veo-3.0-fast-generate-001` | Veo 3 fast stable | Production fast iteration | yes | 4K |
| `veo-2.0-generate-001` | Veo 2 | Silent video, multi-sample | **no** | 720p |

The previous script's default `veo-3.1-generate-001` does not appear in current official docs and is **dropped** from the default chain (see Resolved decisions). Foundation's default chain:

1. `veo-3.1-generate-preview` (preferred — latest generation)
2. `veo-3.0-generate-001` (fallback — latest stable)

Stable preference applies *within the same generation*, not across generations.

**Selection mechanism — curation, not runtime fallback**: this is a *documentation/curation* mechanism, not a runtime resilience mechanism. Foundation does **not** catch API errors and retry with the next model in the chain. If Google decommissions a model between Foundation releases, every default invocation 404s until a maintainer updates `AVAILABLE_MODELS` and `DEFAULT_MODEL_CHAIN` — surfacing this maintenance dependency is intentional, not a bug. The chain is resolved once at startup via a static lookup in `constants.ts`:

```typescript
// constants.ts
export const DEFAULT_MODEL_CHAIN = [
  'veo-3.1-generate-preview',
  'veo-3.0-generate-001',
] as const

export const AVAILABLE_MODELS: ReadonlySet<string> = new Set([
  // Pinned empirically during Foundation implementation (see Open Questions #3, #4).
  // Updates to this set go through a Foundation-touching PR per the maintenance protocol (§6).
  'veo-3.1-generate-preview',
  'veo-3.1-fast-generate-preview',
  'veo-3.1-lite-generate-preview',
  'veo-3.0-generate-001',
  'veo-3.0-fast-generate-001',
  'veo-2.0-generate-001',
])

// resolved lazily on first call (NOT at module load) so tests can mock
// constants before the first invocation:
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
    `None of the models in DEFAULT_MODEL_CHAIN (${DEFAULT_MODEL_CHAIN.join(', ')}) ` +
    `are present in AVAILABLE_MODELS (${[...AVAILABLE_MODELS].join(', ')}). ` +
    `Update constants.ts via the maintenance protocol (§6).`
  )
}

// Test-only helper: reset the cache so vi.mock-injected constants apply.
export function _resetDefaultModelCacheForTests(): void {
  cachedDefault = undefined
}
```

The function takes **no parameter** — the lookup is purely against the static `AVAILABLE_MODELS` constant. **Lazy resolution** (memoized on first call) keeps module-load free of side effects, so `vi.mock('@veo-core/constants', …)` injected before the first call sees its substitutes. The test helper resets the memoization between tests. This removes the previous ambiguity (a parameter named `availableModels` implied a runtime-computed set, contradicting "static" framing).

`AVAILABLE_MODELS` is populated during Foundation implementation by empirically probing each documented model ID against the API. Once pinned, changes go through a Foundation-touching PR per the maintenance protocol (§6). Runtime invocations use the ID resolved at module load — there is no per-call retry on API error. If the chosen model returns 404/403 during generation, that's a real error surfaced verbatim.

**Escape valve for new models**: `AVAILABLE_MODELS` only gates the **default** selection. Users can always pass `--model <any-id>` explicitly — Foundation forwards the value verbatim to the API. This means if Google ships Veo 3.2 before a maintainer updates `AVAILABLE_MODELS`, users aren't blocked: they pass `--model veo-3.2-generate-001` and the request goes through (the API itself validates the ID). The Foundation-touching PR for the constant follows when convenient, not as a blocker.

Users who hardcoded the legacy ID in their own scripts can continue to use it as an explicit `--model` value; Foundation just doesn't pick it as the default anymore.

#### `VeoConfig` type schema — forward declarations

To prevent every downstream sub-project from modifying Foundation's type definitions, the `VeoConfig` interface in `types.ts` declares **all known Veo API input fields as optional from day one**, even those Foundation doesn't validate or consume:

```typescript
export interface VeoConfig {
  // Foundation-owned (validated and consumed here)
  prompt: string
  model?: string
  aspectRatio?: '16:9' | '9:16'
  durationSeconds?: number        // Foundation enforces MODEL_DURATIONS[model] via validation (Veo 3.x → {4,6,8}; Veo 2 → {5,6,7,8}); sub-projects like /veo-extend may allow larger values
  resolution?: '720p' | '1080p' | '4k'
  generateAudio?: boolean
  sampleCount?: number
  seed?: number
  negativePrompt?: string
  enhancePrompt?: boolean
  storageUri?: string
  personGeneration?: 'allow_all' | 'allow_adult' | 'dont_allow'
  outputPath?: string             // local path for download — required iff storageUri is unset (validation rule #9)

  // Forward-declared (validation/semantics added by sub-projects)
  image?: ImageInput              // /veo-animate
  lastFrame?: ImageInput          // /veo-interpolate
  referenceImages?: ImageInput[]  // /veo-multi-shot v2
  videoExtensionInput?: string    // /veo-extend (operation name or GCS uri)
}
```

Foundation's `validateConfig()` ignores the forward-declared fields. Each sub-project composes its own validator via `createValidator()` (see §3) without modifying `VeoConfig`.

#### `ImageInput` and `VertexImage` types

Both types are exported from `types.ts` even though Foundation doesn't consume them — fixing the shape now prevents the three downstream image-consuming sub-projects from diverging.

```typescript
// User-facing input: what callers pass via VeoConfig.image, .lastFrame, .referenceImages
export type ImageInput =
  | { path: string;     mimeType?: string }   // local file (MIME sniffed from extension if absent)
  | { buffer: Buffer;   mimeType: string }    // in-memory bytes (MIME explicit; sniff isn't reliable)
  | { gcsUri: string;   mimeType?: string }   // gs:// reference (no encoding work needed)

// Wire format: what encodeImage(img) returns, ready to drop into the Vertex API request body
export type VertexImage =
  | { bytesBase64Encoded: string; mimeType: string }   // produced from path / buffer
  | { gcsUri: string;             mimeType?: string }  // produced from gcsUri (pass-through)
```

`encodeImage(img: ImageInput): VertexImage` is the only function `buildRequestBody` uses for image fields. Sub-projects that want to add custom image preprocessing wrap their own logic *around* `encodeImage`, not in place of it.

#### CLI flags added

```bash
--negative-prompt "text, logos, watermarks"
--enhance-prompt              # default true
--no-enhance-prompt           # disable
--storage-uri gs://my-bucket/videos/
--person-generation allow_adult
--resolution 4k               # new value
--model veo-3.0-generate-001  # expanded enum
--audio                       # explicit override
--no-audio                    # explicit override
```

### 2. Audio context-aware default

Phase 1 UNDERSTAND already collects `USE CASE`. Foundation derives audio default from it:

| Use case (Phase 1) | Audio default | Reason |
|---|---|---|
| `hero-background` | off | Goes under text overlay; browser autoplay-with-audio blocked |
| `ambient` | off | Silent seamless loop |
| `loop` | off | Audio crossfade in loops introduces artifacts |
| `social` | on | Reels/TikTok/Shorts: audio primary |
| `marketing` | on | Promos, ads, brand stories |
| `product` | on | Showcase with SFX or voiceover |
| `storytelling` (used for multi-shot narrative) | on | Dialogue + sync are the point |
| **Not specified** | **on** | Matches Veo 3.1 API native default; user disables with `--no-audio` |

Explicit `--audio` / `--no-audio` always wins. The Phase 4 PRESENT output shows the resolved audio state with reason ("on (derived from use case=social)").

#### Audio prompting

When audio is on, Phase 2 CRAFT extends the 5-Element Formula with an Audio Layer:

```
[Cinematography] + [Subject] + [Action] + [Context] + [Style & Ambiance] + [Audio Layer]
```

Audio Layer = at least one of:
1. **Dialogue** — always quoted: `a narrator says: "the future arrives in silence"`
2. **SFX** — explicit sonic events: `metallic click, shattering glass`
3. **Ambient** — soundscape: `wind through pines, distant ocean echo`

Anti-patterns in Phase 3 VALIDATE:
- Audio on but no audio descriptors in prompt → **warning**
- Comic-book onomatopoeia (`BAM!`, `WHOOSH!`) → **warning** with suggestion to swap for Foley-style description (e.g., `metallic clang, dust settling`). Not rejected, since Veo 3+ may interpret onomatopoeia as legitimate SFX cues; we surface a softer recommendation instead.
- Dialogue without quotes → **warning** (downgraded from reject to align with the rest of Phase 3 softening; users may want stylized speech)

New file `skills/veo/references/audio-lexicon.md` contains:
- Professional SFX vocabulary (Foley terms)
- Dialogue patterns that fit 8s (~25 words max)
- Ambient patterns per mood (industrial, organic, cinematic)
- Known limit: voice does not extend if absent in last 1s (relevant to future `/veo-extend`)

#### API request construction in `submitGeneration`

`submitGeneration` builds the Vertex AI `predictLongRunning` request body **dynamically** from the resolved `VeoConfig`. This ensures (a) all Foundation cross-cutting parameters are passed when set, and (b) the same function will support future input modalities (`image`, `lastFrame`, `referenceImages`, `videoExtensionInput`) without rewriting — sub-projects extend it via field presence in `VeoConfig`.

Pseudocode shape (illustrative — implementation may differ):

```typescript
// encodeImage returns a Vertex AI image object, NOT a bare string. Declaration in image-helpers.ts:
//   function encodeImage(img: ImageInput):
//     | { bytesBase64Encoded: string; mimeType: string }   // local file or buffer
//     | { gcsUri: string; mimeType?: string }              // gs:// path
// The Vertex API accepts either shape on `image` / `lastFrame` / `referenceImages[]`.

function buildRequestBody(c: VeoConfig) {
  const instance: Record<string, unknown> = { prompt: c.prompt }
  if (c.image !== undefined)                       instance.image = encodeImage(c.image)
  if (c.lastFrame !== undefined)                   instance.lastFrame = encodeImage(c.lastFrame)
  if (c.referenceImages !== undefined && c.referenceImages.length > 0) {
    instance.referenceImages = c.referenceImages.map(encodeImage)
  }
  // NOTE: videoExtensionInput is intentionally NOT handled here.
  // VeoConfig declares it for forward-compat (so /veo-extend doesn't have to modify Foundation
  // types), but the actual API field shape — gcsUri vs operationName vs other — is not yet
  // verified against Vertex AI. /veo-extend owns the implementation: it will add the
  // appropriate `instance.video = { gcsUri: ... }` or `{ operationName: ... }` dispatch
  // after empirical probing of the API. Foundation deliberately does NOT pass-through
  // here to avoid shipping a wrong shape that confuses users with cryptic API errors.

  // All parameter assignments use conditional `!== undefined` for two reasons:
  // (1) avoid sending explicit `undefined` values in JSON (the Vertex API may reject them);
  // (2) consistent treatment of all optional fields — nothing in this object should be
  // present-but-undefined.
  const parameters: Record<string, unknown> = {}
  if (c.aspectRatio !== undefined)      parameters.aspectRatio = c.aspectRatio
  if (c.durationSeconds !== undefined)  parameters.durationSeconds = c.durationSeconds
  if (c.resolution !== undefined)       parameters.resolution = c.resolution
  if (c.generateAudio !== undefined)    parameters.generateAudio = c.generateAudio
  if (c.sampleCount !== undefined)      parameters.sampleCount = c.sampleCount
  if (c.seed !== undefined)             parameters.seed = c.seed
  if (c.negativePrompt !== undefined)   parameters.negativePrompt = c.negativePrompt
  if (c.enhancePrompt !== undefined)    parameters.enhancePrompt = c.enhancePrompt
  if (c.storageUri !== undefined)       parameters.storageUri = c.storageUri
  if (c.personGeneration !== undefined) parameters.personGeneration = c.personGeneration

  return { instances: [instance], parameters }
}
```

Foundation ships `buildRequestBody` with the image forward-declared branches **active** (`image`, `lastFrame`, `referenceImages` — their wire shape is documented in the Vertex AI Veo API and pinned via `encodeImage`). A power user can exercise image-to-video against Foundation's library before `/veo-animate` ships, just without the SKILL.md workflow guidance.

**`videoExtensionInput` is the exception**: Foundation declares the field on `VeoConfig` but does NOT pass it through in `buildRequestBody`. Reason: the wire shape for video extension (`gcsUri` vs `operationName` vs another field name) isn't verified against the API in the spec — it's `/veo-extend`'s responsibility to add the correct dispatch after empirical probing. Until then, setting `videoExtensionInput` is silently ignored by Foundation (rather than producing wrong API calls).

### 3. Cross-parameter validation rules

`validation.ts` centralizes API constraint validation, separate from prompt-quality rules (which remain in `validation/prompt-checklist.md`).

Foundation only validates parameters that Foundation introduces. Rules covering input modalities (`image`, `lastFrame`, `referenceImages`, video extension) are **added by the sub-projects that own those parameters** — they appear in this table only as forward references, not as Foundation deliverables.

| # | Rule | Error if violated | Owned by |
|---|---|---|---|
| 1 | `durationSeconds ∈ MODEL_DURATIONS[model]` — model-specific allowed durations. Veo 3.x: `{4, 6, 8}`. Veo 2: `{5, 6, 7, 8}` (the official doc states 5-8s range; exact set verified empirically per Open Question #4). Mapping table in `constants.ts`. **Unknown model (passed via `--model` escape valve and not in `MODEL_DURATIONS`)**: rule is **skipped** with a soft warning "duration not validated against unknown model — proceed at your own risk". | "durationSeconds X not allowed for model Y; supported: {…}" | Foundation |
| 2 | `resolution ∈ {1080p, 4k}` ⇒ `durationSeconds == 8` | "1080p/4K require duration=8" | Foundation |
| 3 | `model ∈ veo-2.*` ⇒ `generateAudio == false` | "Veo 2 doesn't support audio" | Foundation |
| 4 | `model ∈ veo-2.*` ⇒ `resolution == 720p` | "Veo 2 max resolution is 720p" | Foundation |
| 5 | `prompt.tokens` estimated > 900 (Latin-script approx: chars / 3.5; non-Latin multipliers per Open Question #2). Hard ceiling is 1024 tokens but enforcement is server-side. | **Warning only** at >900 estimated. **Never rejected client-side** — the Veo API has no `countTokens` endpoint (verified against Vertex AI / Gemini API / Veo model docs), so any local heuristic produces false positives. The API rejects oversize prompts immediately with a clear error before generation starts, which is surfaced verbatim in Phase 5. | Foundation |
| 6 | `personGeneration == allow_all` in EU/UK/CH/MENA region (see Open Question #1 for detection mechanism) | Auto-correct + warning: "Region restriction: falling back to allow_adult" | Foundation |
| 7 | `sampleCount ∈ [1, model-max]` per `MODEL_SAMPLE_MAX[model]` (see Open Question #3). **Unknown model**: rule is **skipped** with a soft warning, same convention as rule #1. | "sampleCount out of range for selected model" | Foundation |
| 8 | `aspectRatio ∈ {16:9, 9:16}` only | "Invalid aspect ratio" | Foundation |
| 9 | Exactly one of `outputPath` or `storageUri` must be set on `VeoConfig` | Neither set → "Output destination required: set `outputPath` or `storageUri`". Both set → "Ambiguous output: set either `outputPath` or `storageUri`, not both" | Foundation |
| F1 | `image` present ⇒ `durationSeconds == 8` (image-to-video) | — | `/veo-animate` |
| F2 | `lastFrame` present ⇒ `durationSeconds == 8` AND `image` present | — | `/veo-interpolate` |
| F3 | Video extension input ⇒ `resolution == 720p` | — | `/veo-extend` |
| F4 | `model ∈ veo-3.1-lite-*` ⇒ no `referenceImages`, no extension | — | `/veo-multi-shot v2` + `/veo-extend` |
| F5 | `referenceImages.length ∈ [1, 3]` | — | `/veo-multi-shot v2` |

**Rule composition: factory pattern, not global registry.** `validation.ts` exports `FOUNDATION_RULES` (the array of Foundation-owned rules above) and a `createValidator()` factory:

```typescript
type ValidationRule = (config: VeoConfig) => RuleResult  // RuleResult = ok | warning | error | autoFix

export const FOUNDATION_RULES: ValidationRule[] = [/* rules #1–#9 */]

export function createValidator(opts: {
  baseRules?: ValidationRule[]      // defaults to FOUNDATION_RULES
  extraRules?: ValidationRule[]     // sub-project rules
}): (config: VeoConfig) => ValidationResult
```

Each skill builds its own validator instance from `FOUNDATION_RULES` plus its own rules:

```typescript
// in /veo-animate's CLI:
import { createValidator, FOUNDATION_RULES } from '@veo-core/validation'
import { animateRules } from './rules'  // [imageRequiredRule, durationEightRule]

const validate = createValidator({ extraRules: animateRules })
```

This avoids the pitfalls of a global mutable registry (`registerRule()` was the earlier design): no cross-skill leakage from module-level singletons, no test order dependence, each skill explicitly opts into the rules it applies. Foundation ships `FOUNDATION_RULES` and `createValidator`; sub-projects ship their own rule arrays and import the factory.

#### Auto-corrections

Applied with explicit user notification in Phase 4 PRESENT:

| Situation | Auto-fix | Message |
|---|---|---|
| `resolution=1080p/4k` + `durationSeconds === undefined` (user didn't pass `--duration` flag) | Set `duration=8` | "Bumped duration to 8s to enable 1080p/4K" |
| Region=EU + `personGeneration=allow_all` | Force `allow_adult` | "Region restriction: personGeneration set to allow_adult" |
| `model=veo-2.*` + `generateAudio === undefined` + (use case implies audio) | Set `generateAudio=false` | "Veo 2 doesn't support audio, disabled" |
| `model=veo-2.*` + `generateAudio === true` (user explicitly passed `--audio`) | **No auto-fix — hard error** (rule #3) | "Veo 2 does not support audio. Pass `--no-audio` or switch to a Veo 3 model." |

Auto-fixes apply only when the field is `undefined` (user didn't pass the flag — see option provenance in Data flow §). If the user explicitly set a value that conflicts (e.g., `--duration 6 --resolution 1080p`), validation hard-rejects with an error suggesting the user pick one.

#### `validateConfig()` signature

```typescript
type ValidationResult =
  | {
      valid: true
      warnings: string[]           // soft issues to surface to user
      autoFixed: VeoConfig         // input with defaults applied + auto-corrections; CALLERS USE THIS, not the original input
      autoFixMessages: string[]    // human-readable description of each auto-correction
    }
  | {
      valid: false
      errors: string[]             // hard violations
      suggestions: string[]        // remedial hints for the user
    }

function validateConfig(config: VeoConfig): ValidationResult
```

**Contract**: `validateConfig()` **never throws**. It returns a discriminated union; callers inspect `result.valid` and decide:

- CLI: on `valid: false`, prints errors + suggestions and exits with code 1. On `valid: true`, prints warnings + autoFixMessages, then uses `result.autoFixed` for the API call.
- SKILL.md Phase 3 VALIDATE: surfaces warnings + autoFixMessages to user before Phase 4 PRESENT.
- Programmatic callers of `generateVideo()`: `generateVideo` internally calls `validateConfig`, throws an `Error` with the joined errors when invalid, otherwise proceeds with the auto-fixed config.

Throwing happens only in `generateVideo()`, never in `validateConfig()`. This separation lets test code call `validateConfig()` and inspect results without exception handling.

### 4. Workflow updates (6 phases)

**Phase 1 UNDERSTAND** — extended to derive: model recommendation (from use case + speed intent), audio intent (from use case, override-able), person generation policy (asked only if prompt mentions people).

**Phase 2 CRAFT** — formula extends to 6 elements when audio=on. `negativePrompt` auto-suggested for common scenarios (hero background → suggest `"text overlays, logos, watermarks"`).

**Phase 3 VALIDATE** — rule revisions:
- "REJECT: Text/UI element requests" → warning only when prompt requests text *visible in frame*. Quoted dialogue now natively supported in Veo 3+.
- "Single camera movement" → reject for loop/hero use cases only; warning (not reject) otherwise. Marketing/storytelling can use composed movements.
- New: `audio=on` without Audio Layer descriptors → warning.
- New: invoke `validateConfig()` for hard API constraint violations.

**Phase 4 PRESENT** — new format includes resolved settings, auto-adjustments applied (with reasons), validation warnings, and cost estimate from `estimateCost()`:

```
READY FOR REVIEW:

Prompt: [...]
Settings:
  Model: veo-3.0-generate-001 (stable)
  Aspect: 16:9
  Duration: 8s
  Resolution: 1080p
  Audio: on
  Person generation: allow_adult
  Negative prompt: "text, logos, watermarks"

Auto-adjustments applied:
  - Duration bumped 6→8s (required by 1080p)

Validation: PASSED (2 warnings)
  ⚠ Audio is on but prompt has no Audio Layer descriptors — consider adding dialogue/SFX/ambient
  ⚠ Use case "hero-background" but audio=on — sure?

Cost estimate: ~$X.XX (Veo 3 quality, 8s, 1080p, audio)
Generation time: 2-4 minutes

Shall I generate?
```

**Phase 5 GENERATE** — enriched error handling:
- `raiMediaFilteredCount > 0`: surface "Safety filter triggered: <reason>", suggest prompt edit
- Audio blocked (no charge): "Audio rejected, no charge applied, video saved without audio"
- Quota exceeded: suggest switch to Fast variant
- Region restriction: pre-applied in Phase 4; explicit override fails with clear message

**Phase 6 ITERATE** — new diagnostic rows:
| Problem | Solution |
|---|---|
| Poor audio sync | More specific Audio Layer; short dialogue (~5 words) |
| Cost too high | Switch to Fast or Lite; try 720p |
| Output too generic | Disable `enhancePrompt`; tighten prompt |
| Region blocks persons | Set `allow_adult` explicitly |

### 5. Backwards compatibility

| Change | Breaking? | Mitigation |
|---|---|---|
| Code moved to `_shared/veo-core/` | No | CLI paths unchanged (`skills/veo/scripts/veo-generate.ts` remains) |
| Audio default changes (off → context-aware; on when use case unspecified) | **Yes, behavioral** | Documented in CHANGELOG; explicit `--no-audio` restores old behavior. Phase 4 PRESENT shows resolved audio state |
| Default model `veo-3.1-generate-001` → `veo-3.1-generate-preview` (and `veo-3.0-generate-001` fallback) | **Yes, behavioral** | Documented in CHANGELOG; the legacy ID `veo-3.1-generate-001` is dropped from the default chain because it doesn't appear in current docs. Users who hardcoded the legacy ID in their own scripts can keep doing so — the spec only changes the *default*. Aligned with the "Resolved decisions" section. |
| New `validateConfig()` rules with auto-fix | No | Auto-fix is additive; rejects only what API would reject anyway |
| Extended `VeoConfig` type — most new fields are truly optional | No | — |
| `VeoConfig.outputPath` is **additive-required** when `storageUri` is unset | **Yes, behavioral** | Rule #9 hard-errors if neither `outputPath` nor `storageUri` is set. Callers using the previous `generateVideo(config, outputPath)` signature must now pass `outputPath` (or `storageUri`) **inside** the config object. Migration is mechanical and the error message is explicit, but it's not source-compatible with the previous shape. |

Plugin version in `.claude-plugin/plugin.json` is currently `1.0.0`. Foundation bumps it to `1.1.0` (semver minor).

**Rationale for minor (not major)**: this is honest semver-minor only because the override flags exist and the CHANGELOG is prominent — *not* because the behavior is unchanged.

- **Audio default**: users who never passed `--audio` will see `generateAudio=true` after Foundation when their use case is `social`/`marketing`/`product`/`storytelling` (or when use case is unspecified). The previous implicit default was `false`. This is a real behavioral change with billing implications (audio generation costs more). Mitigations: (a) prominent CHANGELOG entry, (b) `--no-audio` override always restores the previous behavior, (c) Phase 4 PRESENT always shows the resolved audio state with reason before generation starts, giving the user a chance to abort.
- **Model ID default**: changes only the *implicit* default. Users who hardcoded a specific `--model` value see no change.

The new `CHANGELOG.md` (Keep-a-Changelog format) prominently documents both changes so consumers can adjust. If field experience shows users actually broke from the audio-default change, we'll consider a 1.x → 2.0.0 retroactive declaration in the next release.

### 6. Pricing strategy

`pricing.ts` exposes `estimateCost(config: VeoConfig): { usd: number; breakdown: string }`. Implementation:

```typescript
// pricing.ts
// Last updated: 2026-05-23
// Source: <official pricing URL — to be filled at implementation time>
// REVIEW BEFORE EACH RELEASE
const PRICING = { ... } as const
```

The source URL and review-on-release invariant are encoded as file-level comments. Pricing is a manually-maintained lookup table keyed by `model × resolution × duration × audio × sampleCount`. Since users pay per generated video, `sampleCount` is a strict multiplier in the final estimate. Estimate displayed in Phase 4 PRESENT with breakdown.

Automatic pricing-API integration is out of scope; pricing remains manual until enough churn justifies automation.

#### Pricing & constants maintenance protocol

To prevent 4 downstream sub-projects from each forking the pricing table or model constants list, Foundation establishes the following invariants:

- **Single owner per release**: `pricing.ts` and `constants.ts` are owned by Foundation. Any sub-project that needs to add a model, cost vector, or constant lands a Foundation-touching change in its own PR, not an inline duplicate in its skill folder.
- **Dated header is the audit trail**: every PR that touches `pricing.ts` updates the `// Last updated: YYYY-MM-DD` comment and the `// Source:` URL if applicable.
- **No skill-local pricing**: skills must `import { estimateCost } from '@veo-core/pricing'`. Hardcoded `~$0.50` strings in SKILL.md examples are allowed (they're guidance), but generated cost estimates must come from `estimateCost()`.
- **Release-time review**: at each plugin version bump, the maintainer re-validates `pricing.ts` against the current source URL and confirms the dated header.

## Testing strategy

### Test runner + CI setup (prerequisite)

The repository currently has **no test runner, no `.github/workflows/`, and no existing test suite**. Foundation must introduce these before unit tests are meaningful as a quality gate. Concretely:

- **Test runner**: add `vitest` (TypeScript-native, no transpile step, ESM-friendly) as a devDependency. Lightweight enough to fit a plugin that previously had no build infrastructure.
- **`package.json`**: introduce at repo root with `devDependencies: { vitest, ts-node, typescript, @types/node }` and `dependencies: { google-auth-library, @google-cloud/storage, tsconfig-paths }`, plus `scripts: { test: "vitest run", "test:watch": "vitest" }`. Notes: `ts-node` pinned as devDep so all developers/CI use the same version. `tsconfig-paths` is a runtime dep registered via the bootstrap file (see below). `@google-cloud/storage` is needed by `image-helpers.ts`'s `uploadImageToGcs` and by `storageUri` handling.
- **CI workflow**: add `.github/workflows/test.yml` running `npm ci && npm test` on pull requests against `main`. No deployment, no integration with paid APIs (those remain manual per release checklist).
- **No CI for billed integration tests**: the manual release checklist (paid, ~$X per round) is explicitly out of CI scope; it runs once before merge by the maintainer.

This wiring is part of Foundation, not deferred — without it, the unit tests below are aspirational rather than enforced.

### Unit tests (free, deterministic)

Run on every PR via the new CI workflow; mock or pure functions only.

- `validation.test.ts` — every rule in §3 with valid + invalid input
- `pricing.test.ts` — full matrix model × resolution × duration × audio × sampleCount
- `audio-default.test.ts` — use-case → audio default table from §2
- `auto-fix.test.ts` — every auto-correction produces expected message + corrected config
- `model-routing.test.ts` — given use case + speed intent, suggested model is the documented one

### Manual integration tests (paid, bounded)

Checklist in `docs/foundation-release-checklist.md`, executed before merge. ~6-8 generations with cost cap:

1. Default hero background (regression: audio off, 720p, 4s, loop flags)
2. Marketing with audio on (dialogue + SFX present in output audio track)
3. 1080p forces duration=8 (auto-fix observable in Phase 4 PRESENT log)
4. 4K + 8s (new capability succeeds)
5. `negativePrompt` excludes targeted element (qualitative check)
6. `enhancePrompt=false` produces visibly different output from `enhancePrompt=true` with same prompt
7. Veo 2 + audio=on → auto-fix to audio=off (validation log captured)
8. Lite model generates successfully at lower cost (cost log captured)

PR description includes the checklist with checkmarks and links to generated videos.

### Pricing oracle review

At each release, the maintainer re-reads the official pricing URL and confirms the lookup table is current. The "Last updated" comment in `pricing.ts` is the audit trail.

## Resolved decisions

These were Open Questions in earlier revisions of the spec and have been resolved through documentation review or explicit user direction. Kept here as audit trail:

- **Default model ID**: `veo-3.1-generate-preview` (latest generation; falls back to `veo-3.0-generate-001` if unavailable). Legacy ID `veo-3.1-generate-001` was not found in current docs and is dropped.
- **Import strategy**: `@veo-core/*` path alias via `tsconfig-paths`, registered programmatically by `bootstrap.ts` (not via `NODE_OPTIONS` — shebangs and CWD-relative resolution made that approach unreliable).
- **Validation composition**: `createValidator({ baseRules, extraRules })` factory pattern (not a global `registerRule()` registry). Avoids module-load order coupling, cross-skill leakage, and test-order dependence.
- **Token counting** (rule #5) **never hard-rejects**: verified Veo has no `countTokens` endpoint. See rule #5 description and Open Question #2 for the script-aware heuristic that powers the soft warning.
- **Output destination**: `outputPath` lives on `VeoConfig` (not as a separate `generateVideo` argument); rule #9 enforces that exactly one of `outputPath` / `storageUri` is set.
- **Image input shape**: `ImageInput` and `VertexImage` types pinned in §1 to prevent downstream sub-project divergence.
- **`downloadFile` error handling**: explicit HTTP status validation (non-2xx/3xx throws with status + body) + partial-file cleanup on error.
- **Authentication**: `google-auth-library` npm package (not shelling out to `gcloud` CLI). Native support for Service Accounts / ADC / Workload Identity; works in containers and CI.

## Open questions

1. **Region detection**: rule #6 (`personGeneration` regional restriction) requires knowing the user's region for proactive auto-fix. Resolution is **two-tier**:

   - **Tier 1 — explicit `VEO_REGION` env var**: values `us`, `eu`, `uk`, `ch`, `mena`, `other`. Highest priority.
   - **Tier 2 — inferred from `GOOGLE_CLOUD_LOCATION`** (already used for Vertex AI endpoint URL). Mapping in `constants.ts`:
     - `us-*`, `northamerica-*` → `us`
     - `europe-*` → `eu` (further split into `uk` if `europe-west2`, `ch` if `europe-west6`)
     - `me-*` → `mena`
     - `asia-*`, `australia-*`, `southamerica-*` → `other`
   - If neither is set or the inference yields no match, auto-fix is skipped and the API error (if any) is surfaced verbatim in Phase 5 GENERATE.

   The inference is best-effort — users with multi-region setups can override via `VEO_REGION`.
2. **Token counting** (rule #5): heuristic varies by script. Foundation uses per-script multipliers detected via Unicode range scan, with conservative defaults to avoid underestimation:

   | Script range | Ratio (chars per token) | Notes |
   |---|---|---|
   | Latin (default) | 3.5 | Tuned for English; reasonable for most Western languages |
   | CJK (`一–鿿`, `぀–ヿ`, `가–힯`) | 0.5 | Tuned to realistic value: 1 char ≈ 2 tokens in modern tokenizers. (Earlier draft said 1.0 "over-counts safely" — that was a math error: with `tokens ≈ chars/ratio`, a *smaller* ratio means *higher* estimated tokens. 0.5 is the honest mean; the table doesn't pretend to be conservative.) |
   | Cyrillic (`Ѐ–ӿ`) | 2.0 | Conservative; varies by word morphology |
   | Arabic (`؀–ۿ`) | 2.0 | Conservative |
   | Hebrew (`֐–׿`) | 2.0 | Conservative |
   | Devanagari (`ऀ–ॿ`) | 1.8 | Conservative for Hindi/Sanskrit |

   Detection (weighted-average, deterministic): scan the prompt, count chars per script range, and compute the estimated tokens as the **sum of per-script contributions**:

   ```
   estimated_tokens = Σ (chars_in_script_s / ratio_for_script_s)
   ```

   Example — a 1000-char prompt that is 90% Latin + 10% CJK:

   ```
   = 900 / 3.5  +  100 / 0.5
   = 257.1      +  200
   ≈ 457 tokens
   ```

   The previous "single most-restrictive multiplier" rule would have applied 0.5 to all 1000 chars → 2000 tokens (4× over-count). The weighted formulation matches per-script reality and avoids both spurious warnings on mostly-Latin prompts with token of CJK, and under-counts on the opposite case. Detection of script per char uses Unicode range membership (Latin default, CJK/Cyrillic/Arabic/Hebrew/Devanagari per the table above). Chars outside the listed ranges (e.g., symbols, punctuation) count as Latin. Mitigation tiers: (a) rule #5 acts as a **soft warning** at >900 estimated tokens — **never a hard reject** (see rationale below); (b) when a non-Latin multiplier is used, the warning notes "estimate approximate for non-Latin content"; (c) Phase 5 API-side token errors are surfaced verbatim and tagged for the maintainer to revisit the ratios.

   **No `countTokens` pre-flight check** — verified against Vertex AI multimodal docs, Vertex AI REST reference, Gemini API tokens doc, and the Veo 3.1 model page: the `countTokens` endpoint supports only Gemini models (Gemini 3.1 Flash-Lite/Pro/Image, 3 Flash/Pro Image, 2.5 Pro/Flash variants). Veo is **not** in the supported list, and no per-model token counter exists. Any local heuristic would therefore produce false positives. Foundation accepts this and lets the Veo backend enforce the limit; the API's error message surfaces immediately (validation backend, not after the 2-4 min generation), so the UX cost of a missed warning is minimal.
3. **`sampleCount` upper bound per model**: official docs are contradictory — the main Veo page states "Veo 2 supports 2; Veo 3+ generates 1", while the `veo-3.1-generate-preview` model page states "Max output videos: 4 per request". The current script accepts 1-4 universally. Foundation defers the authoritative answer to empirical verification: probe each model with `sampleCount=2,3,4` and encode the discovered limits as a per-model constant in `constants.ts`.
4. **Veo 2 allowed durations**: official doc states a "5-8 seconds" range. It's unclear whether all integer values in that range are accepted or only specific values (e.g., 5/6/7/8 vs only 5/8). Foundation provisionally sets `MODEL_DURATIONS["veo-2.0-generate-001"] = {5, 6, 7, 8}` (rule #1) and verifies empirically during implementation by submitting each value and recording which succeed. The discovered set is encoded in `constants.ts` with an inline `// PROVISIONAL — verify and update after empirical probing` comment until the verification PR closes this question. Veo 2 is also still subject to Open Question #3 (`sampleCount` upper bound), so both verifications can be done in the same probe pass. Veo 3.x is well-documented at `{4, 6, 8}` and does not need this verification.

## Risks & contingency

**Scope risk — Foundation bundles 3 concerns**: refactor lib, params+models+validation, audio context-aware system. Agent review flagged this as a possible scope-creep risk. Mitigation: if during implementation any of these sub-systems drifts past the planned size (e.g., audio context-aware requires more workflow rewriting than estimated), the implementer is authorized to split Foundation into two PRs without re-running this brainstorming step:

- **Foundation-A**: shared lib refactor + cross-cutting parameters + validation + image plumbing + 4K + model expansion. *Unblocks all four downstream sub-projects.*
- **Foundation-B**: audio context-aware default + audio lexicon + Phase 1/2/3 workflow rewrites. *Can ship in parallel with `/veo-animate` or `/veo-interpolate`.*

The split is a contingency, not the default plan. Default is single PR. The implementer makes the call based on actual PR size when work is ~70% complete.

## Migration plan

1. **Root infrastructure setup**: add root `package.json` with `vitest`, `ts-node`, `typescript`, `@types/node` (devDeps) and `google-auth-library`, `@google-cloud/storage`, `tsconfig-paths` (deps — all used at runtime by scripts); add root `tsconfig.json` declaring the `@veo-core/*` path alias → `skills/_shared/veo-core/*`; add `vitest.config.ts` referencing the same `tsconfig.json` so tests resolve the alias; add `skills/_shared/veo-core/bootstrap.ts` (see Architecture) registering `tsconfig-paths` programmatically with `findRepoRoot()`; add `.github/workflows/test.yml` running `npm ci && npm test` on PRs to `main`; update `.gitignore` to include `node_modules/`, `package-lock.json` (if not committing), and `coverage/`. Verify a trivial test that imports a module via `@veo-core/*` alias passes in CI before proceeding.
2. Create `skills/_shared/veo-core/` with extracted modules (`auth.ts`, `api.ts`, `generate.ts`, `types.ts`, `constants.ts`); no behavioral change yet.
3. Add `image-helpers.ts` and `ImageInput` type — exported but not yet consumed by Foundation.
4. Refactor `skills/veo/scripts/veo-generate.ts` to import from `_shared`; verify regression via existing examples.
5. Refactor `skills/veo-multi-shot/scripts/veo-multi-generate.ts` similarly.
6. Add new cross-cutting parameters + CLI flags to `_shared` and `veo-generate.ts`.
7. Implement `validation.ts` with Foundation rules (#1–#9), exporting `FOUNDATION_RULES` array and the `createValidator({ baseRules, extraRules })` factory so sub-projects can compose their own validators without modifying Foundation.
8. Implement `pricing.ts` with verified table + dated header.
9. Empirical verification of Open Questions #3 (`sampleCount` per model) and #4 (Veo 2 allowed durations); update `constants.ts`. Also: probe `AVAILABLE_MODELS` to confirm each documented ID accepts requests (rejects with sensible errors otherwise). **Budget warning**: this probe burns paid API credit — ~6 models × 3 sample counts × 4 durations ≈ 72 generations, at ~$2.50/gen ≈ $180. Run only when the rest of Foundation is solid enough that the probe results won't be invalidated by other changes. Record results in the PR (or a dedicated `docs/foundation-probe-results.md`) so future maintainers can re-run only the deltas.
10. Update `skills/veo/SKILL.md`: new params section, audio context-aware logic, updated workflow phases, new model decision table. **Extend Phase 1 USE CASE enum** to: `hero-background | marketing | social | product | ambient | loop | storytelling` — adding `loop` and `storytelling` so the audio default table in §2 has exact 1:1 enum matches.
11. Update `skills/veo/validation/prompt-checklist.md`: soften obsolete rules.
12. Write `skills/veo/references/audio-lexicon.md`.
13. Update `skills/veo/examples/` with audio prompt examples.
14. Write `CHANGELOG.md` documenting behavioral changes; bump `plugin.json` version 1.0.0 → 1.1.0.
15. Run manual integration checklist; record results in PR.

## Success criteria

- All existing `veo-generate.ts` example invocations from current README still succeed with identical output (modulo audio default change — explicitly documented).
- `wc -l skills/veo/scripts/veo-generate.ts` substantially smaller than the 595-line baseline (target: ~150 lines, accept up to ~200 if clarity demands). The metric is "did the refactor extract the right concerns into `_shared/`?", not a hard line budget.
- `wc -l skills/veo-multi-shot/scripts/veo-multi-generate.ts` substantially smaller, same intent as above.
- CI workflow runs on PR and fails when any unit test fails.
- 100% of rules in §3 have unit tests; `vitest` reports pass on a clean checkout.
- Manual integration checklist passes 8/8.
- `/veo` SKILL.md documents every new parameter with at least one example.
- A subsequent sub-project (e.g., `/veo-animate`) can be added by creating only a new skill folder + thin CLI, importing all infrastructure from `_shared/veo-core/`.
