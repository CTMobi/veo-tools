# Veo Foundation — Design Spec

**Date**: 2026-05-23
**Status**: Proposed (under review) — last Vertex AI doc reconciliation: 2026-06-16
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
      constants.ts                  # AVAILABLE_MODELS, DEFAULT_MODEL_CHAIN, MODEL_DURATIONS, MODEL_SAMPLE_MAX, AUDIO_DEFAULTS, DURATION_SUGGESTIONS, MODEL_SUGGESTIONS, REGIONS, MAX_TOKENS, TOKEN_WARNING_THRESHOLD
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

1. The existing scripts have a `#!/usr/bin/env npx ts-node` shebang (verified against `skills/veo/scripts/veo-generate.ts`). `NODE_OPTIONS` *can* be honored on direct invocation if the caller has it set in their environment — but it cannot be embedded in the shebang and is therefore easy to forget in ad-hoc invocations, CI scripts, or new contributor setups. Relying on every entry point to remember an out-of-band env var is brittle.
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

Every runtime CLI entry point (each `*-generate.ts`) imports the bootstrap **as its first line**:

```typescript
#!/usr/bin/env ts-node
import '../../_shared/veo-core/bootstrap'   // first import — registers @veo-core/* alias
import { generateVideo } from '@veo-core/generate'   // alias now resolves
// ... rest of CLI
```

**Shebang choice**: `#!/usr/bin/env ts-node` — the single-argument form recommended by the ts-node docs. **Do not use `#!/usr/bin/env npx ts-node`** (the current script's shebang, which Foundation fixes): on Linux the kernel treats everything after `/usr/bin/env` as a single argument, so the kernel tries to exec a binary literally named `"npx ts-node"` and fails.

The single-argument form requires `ts-node` to be resolvable on the caller's `PATH` at exec time. `devDependencies` alone is *not* sufficient: `node_modules/.bin` is added to `PATH` only when scripts run via `npm run`/`npm exec`/`npx`, not for arbitrary direct invocations from a fresh shell. Three viable invocation paths, all documented in the release notes and CONTRIBUTING:

- `npm exec ./skills/veo/scripts/veo-generate.ts -- --prompt "…"` (recommended — explicit, portable, no global install)
- `npx ts-node skills/veo/scripts/veo-generate.ts --prompt "…"` (equivalent)
- Global `npm install -g ts-node` then direct `./skills/veo/scripts/veo-generate.ts …` (avoid in CI; convenient for local dev)

If a future need arises to pass flags via the shebang itself, use `#!/usr/bin/env -S npx ts-node` (requires GNU coreutils ≥ 8.30 — present on Ubuntu ≥ 19.10, Debian ≥ 11, RHEL ≥ 9, macOS via Homebrew coreutils; absent on Ubuntu 18.04 and RHEL 7) instead of the broken multi-arg form.

The first import uses a relative path because the alias isn't registered yet. From then on, all imports use the alias. Tests under `vitest` get the alias via `vitest.config.ts` `resolve.alias`, mirroring the bootstrap so test discovery works without importing the bootstrap manually.

Rationale for choosing aliases over relative imports: we are already adding root infrastructure (`package.json`, `vitest`, CI workflow) for the test runner. The marginal cost of also adding a root `tsconfig.json` + bootstrap file is small, and the four downstream sub-projects will each import from `_shared/` — relative paths like `../../_shared/veo-core/pricing` repeated across all of them are brittle and cluttered.

### Module boundaries

| Module | Public API | Internal |
|---|---|---|
| `auth.ts` | `getAccessToken(): Promise<string>` | **Uses `google-auth-library`** npm package (not shelled-out `gcloud` CLI). Supports Service Accounts, ADC, and Workload Identity natively. Removes dependency on gcloud CLI being installed in the execution context — important for CI/CD and containerized usage. The previous `gcloud auth print-access-token` call in `veo-generate.ts` is replaced. |
| `api.ts` | `submitGeneration(config, token): Promise<operationName>`, `pollOperation(opName, token): Promise<status>`, `downloadFile(target, path, token): Promise<void>` (where `target` is either an `https://…` URL or a `gs://…` URI) | URL building, request handling. `makeRequest` (internal) handles HTTPS API calls — does **not** follow redirects (the predict/poll endpoints are not expected to return 3xx) — and uses a **30-second total-request timeout** appropriate for short metadata calls. `downloadFile` accepts both `https://` (downloads via HTTPS, follows redirects manually with a **max-depth limit of 10** — aligned with `follow-redirects` and `axios` defaults; CDN chains and GCS signed-URL flows can exceed 5; validates non-2xx/3xx → throws with status + body **capped at 1 KB** to prevent OOM if a misbehaving server returns a huge error payload; **writes to `${outputPath}.${randomSuffix}.tmp` and atomically renames to `outputPath` only on full success** (random suffix prevents collisions if multiple processes target the same output path concurrently), so a crashed or killed process leaves a stranded `.tmp` instead of a corrupt final file. The same atomic-write pattern applies to the `gs://` branch — `@google-cloud/storage` downloads also go through the temp file + rename, not direct to `outputPath`; uses a **socket idle timeout of 30s** plus a **max total duration of 15 minutes** as a belt-and-suspenders guard against connections that keep sending bytes at near-zero throughput — neither limit alone protects against the other; **on each redirect, if the target origin differs from the current request's origin, the `Authorization` header is stripped before following** — where *origin* is `scheme + host + port` per RFC 6454, so HTTPS→HTTP redirects on the same host are cross-origin even though hostname matches — this prevents Vertex bearer tokens leaking to e.g. signed GCS URLs on `storage.googleapis.com`, which already carry their own auth and would also reject a bearer token; **HTTPS→HTTP redirects are rejected outright** regardless of header handling — the video payload itself is sensitive and must not transit cleartext even with credentials stripped) and `gs://` (downloads via `@google-cloud/storage` client — that library handles its own retries and timeouts). The Vertex AI Veo API can return either form in `status.videoUrl` depending on project configuration. |
| `generate.ts` | `generateVideo(config: VeoConfig): Promise<GenerationResult>` | orchestrates auth → validate → submit → poll → (download \| skip if `storageUri` set). Output destination is read from `config.outputPath` or `config.storageUri`; exactly one must be set, enforced by validation rule #9. |
| `validation.ts` | `validateConfig(config: VeoConfig, context?: ExecutionContext): ValidationResult` — **return-only contract: never throws**. `context` is optional; when omitted, the validator resolves environment-derived inputs (region, etc.) from env vars internally so rules never touch `process.env`. Tests pass an explicit context to avoid global state. Caller inspects `result.valid` and decides action. | rule registry, auto-fix logic |
| `pricing.ts` | `estimateCost(config: VeoConfig): { usd: number; breakdown: string }` | lookup table, last-updated marker comment |
| `image-helpers.ts` | `validateImage(img: ImageInput): void` (synchronous validation: throws on invalid MIME, unreachable local file, or malformed `gs://` URI; **does NOT verify GCS object existence** — that would require an async API call. Use `uploadImageToGcs` or rely on the API call itself for actual reachability), `encodeImage(img: ImageInput): VertexImage`, `uploadImageToGcs(localPath: string, gcsUri: string): Promise<string>` | MIME sniffing, base64 encoding, file I/O, GCS API. `encodeImage` is the single public function used by `buildRequestBody`; the earlier `encodeImageBase64(path)` shape from prior drafts is dropped to keep the API surface unambiguous. |
| `types.ts` | exports type definitions only | — |
| `constants.ts` | exports frozen objects/arrays (`AVAILABLE_MODELS`, `DEFAULT_MODEL_CHAIN`, `MODEL_DURATIONS`, `MODEL_SAMPLE_MAX`, `AUDIO_DEFAULTS`, `DURATION_SUGGESTIONS`, `MODEL_SUGGESTIONS`, `REGIONS`, `MAX_TOKENS`, `TOKEN_WARNING_THRESHOLD`) plus functions `resolveDefaultModel()` (called by `validateConfig` step 1) and `detectRegion()` (called by rule #6 via `ExecutionContext`). Internal: `_resetDefaultModelCacheForTests()`. | — |

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
              │             HTTPS request with 30s socket-idle + 15min total timeout; follow redirects (max 10);
              │             strip Authorization header on cross-origin redirects; reject HTTPS→HTTP redirects;
              │             write to ${outputPath}.${randomSuffix}.tmp, rename atomically on success;
              │             validate non-2xx/3xx → throw with status + body;
              │             cleanup partial file on error
        └─> GenerationResult — videoPath set when downloaded, gcsUri set when storageUri used,
            warnings propagated from result.warnings (validation soft warnings + any phase-5 notes)
```

**Option provenance**: the CLI parser leaves a field `undefined` in `VeoConfig` when the user did NOT pass the corresponding flag. Defaults are applied inside `validateConfig()` (not in the parser). This lets validation distinguish "user explicitly set duration=6" (treat as user intent, hard-error if it conflicts with 1080p) from "duration not set, defaulting to 8" (apply auto-fix silently). The `result.autoFixed` config carries the final resolved values.

**Internal ordering inside `validateConfig()`** (matters because rules #1, #3, #4, #7 read `config.model`):

1. **Resolve mandatory dependencies first** — narrowly: calling `resolveDefaultModel()` if `config.model === undefined`. After this step, `config.model` is a non-undefined string. *Other defaults (audio, resolution, duration, etc.) are NOT applied here* — that would lose the `undefined` signal that step 3 needs to distinguish user intent from defaults. **`resolveDefaultModel()` can throw** (e.g., `AVAILABLE_MODELS` is empty or misconfigured); `validateConfig()` wraps the call in try/catch and converts any exception into a `{valid: false, errors: [e.message], suggestions: ['Update constants.ts via the maintenance protocol (§6)']}` result. This preserves the never-throws contract of `validateConfig()` and gives callers the same diagnostic guidance as a direct `resolveDefaultModel()` call.
2. **Run all rules** against the config (with `model` now resolved). Rules can assume `config.model` is non-undefined; **all other fields may still be `undefined` and rules MUST guard accordingly** — every rule short-circuits to "no violation" when its input field is `undefined`, because the field hasn't been user-set yet and step 3 may auto-fix or default it. This is a *contract* on rule implementations, not a convention: a rule that crashes or returns `false` on `undefined` is a bug. Example: rule #1 (`MODEL_DURATIONS.get(model)?.has(durationSeconds)`) returns `false` when `durationSeconds === undefined` (because `Set.has(undefined)` is `false`), so the rule must explicitly check `if (config.durationSeconds === undefined) return { ok: true }` before invoking the membership test. The single exception is rule #9 (`outputPath` XOR `storageUri`), which *requires* checking the undefined state of both fields to detect "neither set" — that's the rule's whole job. Rules check explicit conflicts (e.g., "user set duration=6 AND resolution=1080p"), not defaults.
3. **Apply auto-fixes AND remaining defaults** for the auto-correctable cases (region, duration-implied-by-resolution, Veo 2 audio when undefined). This step also fills in any field still `undefined` with its documented default (e.g., `aspectRatio='16:9'`, `resolution='720p'`). `autoFixMessages` only mentions auto-corrections (not default-application), so the user sees what actually changed vs. what was left at its natural default.
4. **Return** `{valid: true, autoFixed: <fully-resolved-config>, warnings, autoFixMessages}` or `{valid: false, errors, suggestions}`.

Without this ordering, an unset `config.model` would cause `MODEL_DURATIONS.get(config.model)` (rule #1) to return `undefined` and the rule would either crash or silently pass — both are bugs. The order above is invariant; tests should assert it.

**Output destination**: `outputPath` lives on `VeoConfig` (not as a second function argument). Rule #9 in `validation.ts` enforces that exactly one of `outputPath` or `storageUri` is set. This keeps the validator as the single source of truth for input shape and lets `generateVideo` have a one-argument signature.

When `storageUri` is set, `outputPath` is ignored and `GenerationResult.gcsUri` carries the final location; `videoPath` is `undefined`. When `storageUri` is unset, the inverse holds. The CLI errors out if neither is provided.

## Detailed design

### 1. Cross-cutting parameters added to `/veo`

| Parameter | Type | Valid values | Default | Notes |
|---|---|---|---|---|
| `negativePrompt` | string | free text | `undefined` | List excluded elements, e.g., `"text overlays, logos, watermarks"`. **Guidance** (not enforced): avoid imperative phrasing like "no X" or "don't show X" — the API treats negative prompts as a list of unwanted elements, not as instructions. |
| `enhancePrompt` | boolean | true / false | `true` | Google rewrites prompt internally; disable for power users |
| `storageUri` | string | `gs://bucket/path/` | `undefined` | If set, video stored on GCS instead of local download |
| `personGeneration` | enum | `allow_all` \| `allow_adult` \| `disallow` | model/region default | Regional restrictions apply (EU/UK/CH/MENA). NB: Vertex AI documentation uses `disallow` (not `dont_allow` — that's the Gemini API value). |
| `addWatermark` | boolean | true / false | `true` (Vertex AI default) | SynthID watermark. Foundation forwards verbatim — disable only when explicitly required (e.g., internal QA without watermark). |
| `includeRaiReason` | boolean | true / false | `undefined` | When true, the Responsible AI filter response includes the reason a video was blocked. Useful for debugging safety-filter rejections. |
| `seed` | integer | 0 – 2^31−1 (i.e. 0 – 2,147,483,647, the inclusive upper bound for a signed 32-bit integer) | random | Already present; documentation notes determinism is best-effort on Veo 3 |
| `resolution` | enum | + `4k` added to existing `720p`, `1080p` | `720p` | 4K requires `duration=8` |
| `model` | string | any Vertex AI Veo model ID; the table below lists the documented defaults/suggestions, not a closed set (consistent with the `--model <any-id>` escape valve described later) | `veo-3.1-generate-001` (GA since 17 Nov 2025; falls back to `veo-3.1-fast-generate-001` if unavailable — see selection rule below) | |

#### Model expansion

> **Important — two API surfaces, different model IDs**: this plugin targets **Vertex AI** (`*-aiplatform.googleapis.com/.../predictLongRunning`). The Vertex AI Veo surface uses the `*-001` model IDs listed below. The **Gemini API** surface (`generativelanguage.googleapis.com`) uses different IDs ending in `*-preview` (e.g. `veo-3.1-generate-preview`, still active on Gemini API as of 2026-06-16 per [ai.google.dev/gemini-api/docs/deprecations](https://ai.google.dev/gemini-api/docs/deprecations)). The same logical model has different IDs on the two surfaces; passing a Gemini API ID (`*-preview`) to Vertex AI will fail. Users coming from the Gemini API docs should translate IDs before passing them via `--model`. The `*-preview` IDs that previously lived on Vertex AI itself were discontinued 2 Apr 2026 and are not in `AVAILABLE_MODELS`.

| Model ID | Variant | Use case | Audio | Max resolution |
|---|---|---|---|---|
| `veo-3.1-generate-001` | Veo 3.1 quality (**GA** since 17 Nov 2025) | Default quality | yes | 4K |
| `veo-3.1-fast-generate-001` | Veo 3.1 fast (**GA** since 17 Nov 2025) | Fast iteration. No `referenceImages` (only the standard variant supports them). | yes | 4K |
| `veo-3.1-lite-generate-001` | Veo 3.1 lite (Preview since 2 Apr 2026) | Lowest cost. Supports text-to-video and image-to-video. No `referenceImages`, no video extension. | yes | 1080p |
| `veo-3.0-generate-001` | Veo 3 (GA — **deprecated**, discontinuation 30 Jun 2026) | Legacy production. No `lastFrame`, no `referenceImages`. Listed for backwards-compat only; do not pick as a new default. | yes | 4K |
| `veo-3.0-fast-generate-001` | Veo 3 fast (GA — **deprecated**, discontinuation 30 Jun 2026) | Legacy production fast iteration. Same EOL date as `veo-3.0-generate-001`. Listed for backwards-compat only; do not pick as a new default. | yes | 4K |
| `veo-2.0-generate-001` | Veo 2 (GA — **deprecated**) | Silent video. Listed for backwards-compat; status uncertain (Gemini API doc marks it deprecated; Vertex deprecation date not confirmed). Do not pick as a new default. | **no** | 720p |

The existing `skills/veo/scripts/veo-generate.ts` already defaults to `veo-3.1-generate-001` (single value, no fallback). Foundation keeps the same default model but introduces a *curation chain* — a documented, ordered list resolved once at startup via static lookup:

1. `veo-3.1-generate-001` (preferred — GA quality model, supports all input modalities including `referenceImages` and `lastFrame`)
2. `veo-3.1-fast-generate-001` (curation fallback — GA in the same generation, same media features minus `referenceImages`)

This is **additive curation**, not a change of default behavior: the model selected at startup is still `veo-3.1-generate-001`. The chain exists so a maintainer can revisit the static order when Google retires a model (see "Selection mechanism — curation, not runtime fallback" below).

Earlier drafts of this spec proposed `veo-3.0-generate-001` as the curation fallback (Veo 3.0 was the latest stable when the spec was first written, May 2026). Veo 3.0 is now **deprecated** with a discontinuation date of 30 Jun 2026, so it's no longer appropriate — it's kept in `AVAILABLE_MODELS` only for backwards-compat with callers that explicitly pass `--model veo-3.0-generate-001`.

Stable preference applies *within the same generation*, not across generations.

**Selection mechanism — curation, not runtime fallback**: this is a *documentation/curation* mechanism, not a runtime resilience mechanism. Foundation does **not** catch API errors and retry with the next model in the chain. If Google decommissions a model between Foundation releases, every default invocation 404s until a maintainer updates `AVAILABLE_MODELS` and `DEFAULT_MODEL_CHAIN` — surfacing this maintenance dependency is intentional, not a bug. The chain is resolved once at startup via a static lookup in `constants.ts`:

```typescript
// constants.ts
export const DEFAULT_MODEL_CHAIN = [
  'veo-3.1-generate-001',       // GA quality model (Nov 2025)
  'veo-3.1-fast-generate-001',  // GA fallback in same generation
] as const

export const AVAILABLE_MODELS: ReadonlySet<string> = new Set([
  // Pinned from the Vertex AI Veo docs verified 2026-06-16.
  // Updates to this set go through a Foundation-touching PR per the maintenance protocol (§6).
  'veo-3.1-generate-001',           // GA   — 17 Nov 2025
  'veo-3.1-fast-generate-001',      // GA   — 17 Nov 2025
  'veo-3.1-lite-generate-001',      // Preview — 2 Apr 2026; no referenceImages, no extension
  'veo-3.0-generate-001',           // GA   — DEPRECATED, discontinuation 30 Jun 2026; no lastFrame, no referenceImages
  'veo-3.0-fast-generate-001',      // GA   — DEPRECATED, discontinuation 30 Jun 2026
  'veo-2.0-generate-001',           // GA   — deprecated per Gemini API doc; status uncertain on Vertex; no audio
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

`AVAILABLE_MODELS` is populated during Foundation implementation by empirically probing each documented model ID against the API. Once pinned, changes go through a Foundation-touching PR per the maintenance protocol (§6). Runtime invocations use the ID **resolved on the first call to `resolveDefaultModel()` and memoized** — subsequent calls return the cached value without re-evaluating. There is no per-call retry on API error. If the chosen model returns 404/403 during generation, that's a real error surfaced verbatim.

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
  durationSeconds?: number        // CLI/library default: 8 (matches existing veo-generate.ts and README). Use-case-aware overrides come from Phase 1 SKILL.md via DURATION_SUGGESTIONS (see §2). Foundation enforces MODEL_DURATIONS.get(model) via validation (Veo 3.x → {4,6,8}; Veo 2 → {5,6,8} per doc 2026-06-16); sub-projects like /veo-extend may allow larger values
  resolution?: '720p' | '1080p' | '4k'
  generateAudio?: boolean
  sampleCount?: number
  seed?: number
  negativePrompt?: string
  enhancePrompt?: boolean
  storageUri?: string
  personGeneration?: 'allow_all' | 'allow_adult' | 'disallow'
  addWatermark?: boolean          // SynthID watermark; Vertex AI default = true (verified 2026-06-16). Foundation passes through unchanged.
  includeRaiReason?: boolean      // include Responsible AI filter reason in the response when content is blocked
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

#### `GenerationResult` type

`generateVideo()` returns:

```typescript
export type GenerationResult = {
  videoPath?: string         // local filesystem path when downloaded (storageUri unset)
  gcsUri?: string            // gs://... when storageUri was set (server-side delivery)
  operationName: string      // Vertex AI long-running operation name (for retry / extension use)
  model: string              // resolved model ID actually used
  durationSeconds: number    // resolved duration
  resolution: string         // resolved resolution
  warnings: string[]         // validation warnings surfaced from validateConfig
}
```

Exactly one of `videoPath` / `gcsUri` is set (mirrors rule #9). The other resolved fields (`operationName`, `model`, etc.) let callers audit what actually happened and feed into future operations (e.g., `/veo-extend` will need `operationName`).

#### `AUDIO_DEFAULTS` and `MODEL_SUGGESTIONS` constants

The audio-default table in §2 and the model-suggestion table (implicit in workflow Phase 1) are codified as named constants in `constants.ts` so they are testable, auditable, and don't drift between the spec, SKILL.md, and library:

```typescript
export const AUDIO_DEFAULTS: Record<string, boolean> = {
  'hero-background': false,
  'ambient':         false,
  'loop':            false,
  'social':          true,
  'marketing':       true,
  'product':         true,
  'storytelling':    true,
  // Unspecified use case → true (Veo 3.1 API native default).
  // Callers check `AUDIO_DEFAULTS[useCase] ?? true` to apply this fallback.
}

export const DURATION_SUGGESTIONS: Record<string, number> = {
  // Phase 1 UNDERSTAND consults this when crafting the CLI invocation.
  // The user's explicit --duration always wins; this is just a SKILL.md
  // hint, not a CLI default. Library/CLI default remains 8 (see VeoConfig).
  'hero-background': 4,   // 4s = smoother loop (less motion to reconcile at loop point)
  'ambient':         4,
  'loop':            4,
  'social':          8,
  'marketing':       8,
  'product':         8,
  'storytelling':    8,
  // Unspecified use case → callers fall through to the CLI default (8).
}

export const MODEL_SUGGESTIONS: Record<string, { quality: string; fast: string; lite?: string }> = {
  // Selection rationale (all use cases route to Veo 3.1 GA):
  //   - All `quality` entries point to `veo-3.1-generate-001`, GA since 17 Nov 2025.
  //     The earlier draft routed marketing/product/storytelling to `veo-3.0-generate-001`
  //     on a "stable for brand content" argument, but Veo 3.0 is now deprecated with
  //     a 30 Jun 2026 discontinuation date — recommending it as a default would have
  //     broken these flows almost immediately. Veo 3.1 is the current "stable" choice.
  //   - hero-background/ambient/loop include `lite` because high-volume hero/ambient
  //     loops on landing pages benefit from cost optimization; social and the brand
  //     use cases (marketing/product/storytelling) omit `lite` on quality grounds,
  //     not capability (Lite does support text-to-video; see the model expansion
  //     table in §1).
  'hero-background': { quality: 'veo-3.1-generate-001', fast: 'veo-3.1-fast-generate-001', lite: 'veo-3.1-lite-generate-001' },
  'ambient':         { quality: 'veo-3.1-generate-001', fast: 'veo-3.1-fast-generate-001', lite: 'veo-3.1-lite-generate-001' },
  'loop':            { quality: 'veo-3.1-generate-001', fast: 'veo-3.1-fast-generate-001', lite: 'veo-3.1-lite-generate-001' },
  'social':          { quality: 'veo-3.1-generate-001', fast: 'veo-3.1-fast-generate-001' },
  'marketing':       { quality: 'veo-3.1-generate-001', fast: 'veo-3.1-fast-generate-001' },
  'product':         { quality: 'veo-3.1-generate-001', fast: 'veo-3.1-fast-generate-001' },
  'storytelling':    { quality: 'veo-3.1-generate-001', fast: 'veo-3.1-fast-generate-001' },
}
```

Both tables are pure data — no logic. `audio-default.test.ts` and `model-routing.test.ts` (in the test plan) become straightforward asserts that the constants match the spec tables. SKILL.md Phase 1 conversational logic reads from these tables rather than hardcoding the values, preventing silent drift.

#### `MODEL_DURATIONS` and `MODEL_SAMPLE_MAX` shapes

Two model-keyed constants drive rules #1 and #7. Both return `undefined` for unknown model keys (the `--model` escape valve case); rules skip with a soft warning when this happens — see rule descriptions in §3.

```typescript
export const MODEL_DURATIONS: ReadonlyMap<string, ReadonlySet<number>> = new Map([
  ['veo-3.1-generate-001',      new Set([4, 6, 8])],
  ['veo-3.1-fast-generate-001', new Set([4, 6, 8])],
  ['veo-3.1-lite-generate-001', new Set([4, 6, 8])],
  ['veo-3.0-generate-001',          new Set([4, 6, 8])],
  ['veo-3.0-fast-generate-001',     new Set([4, 6, 8])],
  ['veo-2.0-generate-001',          new Set([5, 6, 8])],      // per Gemini API doc 2026-06-16 (Veo 2 is deprecated; kept for backwards-compat)
])

export const MODEL_SAMPLE_MAX: Readonly<Record<string, number>> = {
  // Verified against Vertex AI docs (2026-06-16): "Maximum number of output videos per prompt: 4"
  // for all Veo 3.x GA models. The earlier "1 per request" came from the Gemini API doc, which is a
  // narrower surface — Vertex AI's predictLongRunning accepts sampleCount: 1-4.
  // Veo 2 ceiling left at 2 per the original Gemini API doc, but the model is deprecated.
  'veo-3.1-generate-001':      4,
  'veo-3.1-fast-generate-001': 4,
  'veo-3.1-lite-generate-001': 4,  // PROVISIONAL: the Vertex AI doc citation covers Veo 3.x *GA* models;
                                   // Lite is Preview (since 2 Apr 2026) and Preview tiers sometimes carry
                                   // tighter per-request limits than their GA counterparts. The probe pass
                                   // (migration step 9) verifies this value empirically — if it's lower,
                                   // update this entry and document in Resolved decisions.
  'veo-3.0-generate-001':      4,
  'veo-3.0-fast-generate-001': 4,
  'veo-2.0-generate-001':      2,
}
```

`ReadonlyMap` for `MODEL_DURATIONS` lets the consumer call `.has(model)` and `.get(model)?.has(value)` cleanly. `Record` for `MODEL_SAMPLE_MAX` is sufficient because the lookup is a single number, not a membership check.

#### `REGIONS` constant

A flat `Record<string,string>` can't express the precedence-sensitive mapping (`europe-west2` must beat `europe-*`). `REGIONS` is therefore an ordered array of exact-match entries followed by prefix-match entries:

```typescript
export const REGIONS: Array<
  | { type: 'exact';  location: string;  region: string }
  | { type: 'prefix'; prefix: string;    region: string }
> = [
  // Exact matches first — they take precedence over prefix matches.
  { type: 'exact',  location: 'europe-west2',     region: 'uk' },
  { type: 'exact',  location: 'europe-west6',     region: 'ch' },
  // Prefix matches second — checked in order.
  { type: 'prefix', prefix:   'us-',              region: 'us' },
  { type: 'prefix', prefix:   'northamerica-',    region: 'us' },
  { type: 'prefix', prefix:   'europe-',          region: 'eu' },
  { type: 'prefix', prefix:   'me-',              region: 'mena' },
  { type: 'prefix', prefix:   'asia-',            region: 'other' },
  { type: 'prefix', prefix:   'australia-',       region: 'other' },
  { type: 'prefix', prefix:   'southamerica-',    region: 'other' },
]

// Helper consumed by validation rule #6 (personGeneration regional restriction):
export function detectRegion(gcpLocation?: string, envRegion?: string): string | undefined {
  if (envRegion) return envRegion                                // VEO_REGION wins
  if (!gcpLocation) return undefined
  for (const entry of REGIONS) {
    if (entry.type === 'exact'  && entry.location === gcpLocation) return entry.region
    if (entry.type === 'prefix' && gcpLocation.startsWith(entry.prefix)) return entry.region
  }
  return undefined                                               // no match — auto-fix skipped
}
```

**Fallback for unspecified use case in `MODEL_SUGGESTIONS`**: when Phase 1 cannot identify a use case (user says "just make a video"), callers use the same pattern as `AUDIO_DEFAULTS`:

```typescript
const suggested = MODEL_SUGGESTIONS[useCase] ?? {
  quality: resolveDefaultModel(),                     // top of DEFAULT_MODEL_CHAIN
  fast:    'veo-3.1-fast-generate-001',
  // lite intentionally omitted: no use case implies "lowest cost" without explicit signal
}
```

`model-routing.test.ts` covers both the table-hit and the fallback paths.

#### CLI flags added

```bash
--negative-prompt "text, logos, watermarks"
--enhance-prompt              # default true
--no-enhance-prompt           # disable
--storage-uri gs://my-bucket/videos/
--person-generation allow_adult
--resolution 4k               # new value
--model veo-3.0-generate-001  # any Veo model ID — see model expansion table for documented defaults
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

Explicit `--audio` / `--no-audio` always wins.

**Provenance of the audio reason string**: when the user runs `/veo` interactively, the SKILL.md workflow (Phase 1 UNDERSTAND) collects the use case in conversation with Claude. Phase 4 PRESENT then displays the resolved audio state with a reason like "on (derived from use case=social)" — that string is composed by Claude using the conversation context, **not** read from `VeoConfig` or `validateConfig()`'s output. `VeoConfig` itself has no `useCase` field; the library only sees the resolved `generateAudio` boolean. Programmatic callers of `generateVideo()` (outside the SKILL.md flow) bypass the reason-string entirely and just pass `generateAudio` directly.

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
    // Vertex Veo API expects array of {referenceType, image} entries, NOT bare VertexImage[].
    // referenceType is currently only "asset" (per Vertex API docs verified 2026-06-16);
    // future Veo versions may add other reference types (e.g. "style") — keep it as a string
    // so we don't have to widen the type when that happens.
    instance.referenceImages = c.referenceImages.map(img => ({
      referenceType: 'asset',
      image: encodeImage(img),
    }))
  }
  // NOTE: videoExtensionInput is intentionally NOT handled here. If callers pass it,
  // validation rule #10 (forward-declared field warning) emits a warning so the field
  // isn't silently ignored, then this function drops it from the request body so the
  // API receives a clean call. The warning lands in GenerationResult.warnings.
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
  if (c.addWatermark !== undefined)     parameters.addWatermark = c.addWatermark
  if (c.includeRaiReason !== undefined) parameters.includeRaiReason = c.includeRaiReason

  return { instances: [instance], parameters }
}
```

Foundation ships `buildRequestBody` with the image forward-declared branches **active** (`image`, `lastFrame`, `referenceImages` — their wire shape is documented in the Vertex AI Veo API and pinned via `encodeImage`). A power user can exercise image-to-video against Foundation's library before `/veo-animate` ships, just without the SKILL.md workflow guidance.

**`videoExtensionInput` is the exception**: Foundation declares the field on `VeoConfig` but does NOT pass it through in `buildRequestBody`. Reason: the wire shape for video extension (`gcsUri` vs `operationName` vs another field name) isn't verified against the API in the spec — it's `/veo-extend`'s responsibility to add the correct dispatch after empirical probing. Until then, callers who set `videoExtensionInput` get a warning from validation rule #10 (forward-declared field — "declared on `VeoConfig` for forward-compat but Foundation does not implement it"), and the field is then dropped from the request body so the API receives a clean call. The warning surfaces through `ValidationResult.warnings` and ultimately `GenerationResult.warnings` — it is **not** silently ignored.

### 3. Cross-parameter validation rules

`validation.ts` centralizes API constraint validation, separate from prompt-quality rules (which remain in `validation/prompt-checklist.md`).

Foundation only validates parameters that Foundation introduces. Rules covering input modalities (`image`, `lastFrame`, `referenceImages`, video extension) are **added by the sub-projects that own those parameters** — they appear in this table only as forward references, not as Foundation deliverables.

| # | Rule | Error if violated | Owned by |
|---|---|---|---|
| 1 | `MODEL_DURATIONS.get(model)?.has(durationSeconds)` — model-specific allowed durations. Veo 3.x: `{4, 6, 8}`. Veo 2: `{5, 6, 8}` (per Gemini API doc verified 2026-06-16; the previous `{5,6,7,8}` guess was wrong — 7 is not accepted). Mapping table in `constants.ts`. **Unknown model (passed via `--model` escape valve and not in `MODEL_DURATIONS`)**: rule is **skipped** with a soft warning "duration not validated against unknown model — proceed at your own risk". | "durationSeconds X not allowed for model Y; supported: {…}" | Foundation |
| 2 | `resolution ∈ {1080p, 4k}` ⇒ `durationSeconds == 8`. **Two cases**: (a) `durationSeconds === undefined` → **auto-fix to 8** (see Auto-corrections table); (b) `durationSeconds` explicitly set to a value other than 8 → **hard error** because the user's intent conflicts with the resolution. The error message in the next column applies only to case (b). | "1080p/4K require duration=8; got duration=N. Either drop `--duration` (auto-fixes to 8) or change `--resolution` to 720p." | Foundation |
| 3 | `model ∈ veo-2.*` ⇒ `generateAudio == false` | "Veo 2 doesn't support audio" | Foundation |
| 4 | `model ∈ veo-2.*` ⇒ `resolution == 720p` | "Veo 2 max resolution is 720p" | Foundation |
| 5 | `prompt.tokens` estimated > `TOKEN_WARNING_THRESHOLD` (default `900`, in `constants.ts`; Latin-script approx: chars / 3.5; non-Latin multipliers per Open Question #2). Hard ceiling is `MAX_TOKENS` (`1024`) but enforcement is server-side. | **Warning only** at `> TOKEN_WARNING_THRESHOLD` estimated. **Never rejected client-side** — the Veo API has no `countTokens` endpoint (verified against Vertex AI / Gemini API / Veo model docs), so any local heuristic produces false positives. The API rejects oversize prompts immediately with a clear error before generation starts, which is surfaced verbatim in Phase 5. | Foundation |
| 6 | `personGeneration == allow_all` in EU/UK/CH/MENA region (see Open Question #1 for detection mechanism) | Auto-correct + warning: "Region restriction: falling back to allow_adult" | Foundation |
| 7 | `sampleCount ∈ [1, model-max]` per `MODEL_SAMPLE_MAX[model]` (Veo 3.x: 4, Veo 2: 2, verified against Vertex AI docs 2026-06-16). **Unknown model**: rule is **skipped** with a soft warning, same convention as rule #1. | "sampleCount out of range for selected model" | Foundation |
| 8 | `aspectRatio ∈ {16:9, 9:16}` only | "Invalid aspect ratio" | Foundation |
| 9 | Exactly one of `outputPath` or `storageUri` must be set on `VeoConfig` | Neither set → "Output destination required: set `outputPath` or `storageUri`". Both set → "Ambiguous output: set either `outputPath` or `storageUri`, not both" | Foundation |
| 10 | Forward-declared `VeoConfig` fields without Foundation-level semantics (currently `videoExtensionInput`; future additions inherit this rule automatically). If the field is set, validation emits a **warning** explaining it's declared on the type for cross-project compatibility but Foundation does not implement it — the owning sub-project will pick it up. The field is dropped from the request body so the API receives a clean call. | Warning: "<field> is declared on VeoConfig for forward-compat but Foundation does not implement it; the owning sub-project will." | Foundation |
| F1 | `image` present ⇒ `durationSeconds == 8` (image-to-video) | — | `/veo-animate` |
| F2 | `lastFrame` present ⇒ `durationSeconds == 8` AND `image` present | — | `/veo-interpolate` |
| F3 | Video extension input ⇒ `resolution == 720p` | — | `/veo-extend` |
| F4 | Model capability matrix per Vertex AI docs (verified 2026-06-16). The owning sub-projects encode these per-model gates: `referenceImages` requires `model == veo-3.1-generate-001` (Veo 3.1 Fast and Lite don't support it; Veo 3.0 family doesn't either). `lastFrame` requires Veo 3.1 (any variant) — Veo 3.0/3.0-fast don't support last frame. Extension is unsupported on Veo 3.1 Lite. | — | `/veo-multi-shot v2` + `/veo-interpolate` + `/veo-extend` |
| F5 | `referenceImages.length ∈ [1, 3]` | — | `/veo-multi-shot v2` |

**Rule composition: factory pattern, not global registry.** `validation.ts` exports `FOUNDATION_RULES` (the array of Foundation-owned rules above) and a `createValidator()` factory:

```typescript
// ExecutionContext lets callers (especially tests) override the
// environment-derived inputs that rules need, without mutating process.env.
// All fields are optional; missing fields fall back to env var lookup.
export type ExecutionContext = {
  region?: 'us' | 'eu' | 'uk' | 'ch' | 'mena' | 'other'  // overrides VEO_REGION / GOOGLE_CLOUD_LOCATION inference
  // Add other context fields here as future rules need them.
}

type ValidationRule = (config: VeoConfig, ctx: ExecutionContext) => RuleResult  // RuleResult = ok | warning | error | autoFix

export const FOUNDATION_RULES: ValidationRule[] = [/* rules #1–#10 */]

export function createValidator(opts: {
  baseRules?: ValidationRule[]      // defaults to FOUNDATION_RULES
  extraRules?: ValidationRule[]     // sub-project rules
}): (config: VeoConfig, context?: ExecutionContext) => ValidationResult
```

**Why pass a context object instead of reading `process.env` inside rules**: a rule like #6 (regional `personGeneration` restriction) historically would read `process.env.VEO_REGION` or `process.env.GOOGLE_CLOUD_LOCATION` at evaluation time. That ties tests to global mutable state — every region case requires `process.env.VEO_REGION = '…'` in `beforeEach` and a cleanup in `afterEach`, with parallel-test contamination risks. The explicit `context` parameter lets tests pass `{ region: 'eu' }` directly. When `context` is omitted (production CLI path), `createValidator()` resolves the context once at validator-construction time from env vars (Tier 1 `VEO_REGION`, Tier 2 `GOOGLE_CLOUD_LOCATION` mapping) and passes it to every rule — so individual rules never read env vars themselves.

Each rule invocation is **wrapped in try/catch** by `createValidator()`. If a rule function throws (e.g., a sub-project ships a buggy custom rule), the exception is caught and converted to `{ valid: false, errors: ['Rule <name> threw: <message>'], suggestions: ['Report this to the rule\'s owning sub-project'] }`. This preserves `validateConfig()`'s never-throws contract even when extension rules misbehave.

Each skill builds its own validator instance from `FOUNDATION_RULES` plus its own rules:

```typescript
// in /veo-animate's CLI:
import { createValidator, FOUNDATION_RULES } from '@veo-core/validation'
import { animateRules } from './rules'  // [imageRequiredRule, durationEightRule]

const validate = createValidator({ extraRules: animateRules })
// Test that needs a specific region: validate(config, { region: 'eu' })
// Production CLI: validate(config) — context resolved from env vars internally.
```

This avoids the pitfalls of a global mutable registry (`registerRule()` was the earlier design): no cross-skill leakage from module-level singletons, no test order dependence, each skill explicitly opts into the rules it applies. Foundation ships `FOUNDATION_RULES` and `createValidator`; sub-projects ship their own rule arrays and import the factory.

#### Auto-corrections

Applied with explicit user notification in Phase 4 PRESENT:

| Situation | Auto-fix | Message |
|---|---|---|
| `resolution=1080p/4k` + `durationSeconds === undefined` (user didn't pass `--duration` flag) | Set `duration=8` | "Bumped duration to 8s to enable 1080p/4K" — applies only when `durationSeconds` is undefined; an explicit conflicting value is rejected by rule #2 case (b) instead |
| Region=EU + `personGeneration=allow_all` | Force `allow_adult` | "Region restriction: personGeneration set to allow_adult" |
| `model=veo-2.*` + `generateAudio === undefined` | Set `generateAudio=false` | "Veo 2 doesn't support audio, disabled" |
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

function validateConfig(config: VeoConfig, context?: ExecutionContext): ValidationResult
```

**Implementation note**: `validateConfig` is **not a separately-implemented function** — it is exported as the result of `createValidator({ baseRules: FOUNDATION_RULES })`. Concretely:

```typescript
// in validation.ts:
export const validateConfig = createValidator({ baseRules: FOUNDATION_RULES })
```

This inherits the per-rule `try/catch` wrapper from `createValidator()` (see §3 factory section). Implementers must not write a standalone version that loops over `FOUNDATION_RULES` directly — without the wrapper, a buggy Foundation rule that throws would break the never-throws contract.

**Contract**: `validateConfig()` **never throws**. It returns a discriminated union; callers inspect `result.valid` and decide. The optional `context` argument follows the same pattern as `createValidator()`'s returned validator — see "Why pass a context object" above. Production callers omit it; test callers pass explicit region/etc. overrides.

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
| `DEFAULT_MODEL_CHAIN` introduced as curation chain (`veo-3.1-generate-001` → `veo-3.1-fast-generate-001`) | No | Default model selected at startup is still `veo-3.1-generate-001` — same as the current `veo-generate.ts`. The chain is documentation/curation, not runtime fallback. Adding `veo-3.1-fast-generate-001` as a second curated entry is additive. |
| New `validateConfig()` rules with auto-fix | No | Auto-fix is additive; rejects only what API would reject anyway |
| Extended `VeoConfig` type — most new fields are truly optional | No | — |
| `VeoConfig.outputPath` is **additive-required** when `storageUri` is unset | **Yes, source-breaking** | Rule #9 hard-errors if neither `outputPath` nor `storageUri` is set. Callers using the previous `generateVideo(config, outputPath)` signature must now pass `outputPath` (or `storageUri`) **inside** the config object. Migration is mechanical and the error message is explicit, but it's not source-compatible with the previous shape. |

Plugin version in `.claude-plugin/plugin.json` is currently `1.0.0`. Foundation bumps it to `2.0.0` (semver major).

**Rationale for major (not minor)**: SemVer 2.0.0 §8 requires a MAJOR bump when introducing incompatible API changes, regardless of mitigation quality. Foundation introduces two incompatible changes:

- **`generateVideo()` signature change** (source-breaking): the public exported function moves from `generateVideo(config, outputPath)` to `generateVideo(config)` with `outputPath` inside the config. Callers that hardcoded the two-argument call will fail to compile until updated. This is the canonical "incompatible API change" that mandates MAJOR.
- **Audio default**: users who never passed `--audio` will see `generateAudio=true` after Foundation when their use case is `social`/`marketing`/`product`/`storytelling` (or when use case is unspecified). The previous implicit default was `false`. This is a real behavioral change with billing implications (audio generation costs more).

Mitigations are present and useful but do *not* downgrade the bump: (a) prominent CHANGELOG entry, (b) `--no-audio` override always restores the previous behavior, (c) Phase 4 PRESENT always shows the resolved audio state with reason before generation starts, giving the user a chance to abort, (d) the error from rule #9 is explicit and tells the caller exactly what to add. The `2.0.0` label *honestly communicates* that callers may need to recompile.

The new `CHANGELOG.md` (Keep-a-Changelog format) prominently documents both changes so consumers can adjust.

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
- `audio-default.test.ts` — `AUDIO_DEFAULTS` constant matches §2 spec table (use-case → boolean) **and** `DURATION_SUGGESTIONS` matches its table (use-case → seconds). Both are pure lookups with identical test shape; co-located in one file to avoid trivial test-file proliferation.
- `auto-fix.test.ts` — every auto-correction produces expected message + corrected config
- `model-routing.test.ts` — `MODEL_SUGGESTIONS` constant matches the spec table (use-case → {quality, fast, lite?} model IDs)
- `image-helpers.test.ts` — MIME sniff (jpg/png/webp), base64 round-trip for `{path}` and `{buffer}` `ImageInput`, `gs://` URI format validation (valid + malformed: empty bucket, missing path, wrong scheme), `encodeImage()` returns the right `VertexImage` discriminated variant for each input. **Synchronous-only**: tests confirm `validateImage` does NOT make GCS API calls (existence checks deferred to actual upload/generation).

### Manual integration tests (paid, bounded)

Checklist in `docs/foundation-release-checklist.md`, executed before merge. ~9 paid generations (item 8b is pre-API hard-error validation — no charge applied):

1. Default hero background via SKILL.md (regression: Phase 1 use case=`hero-background` → audio off, 720p, 4s via DURATION_SUGGESTIONS, loop flags). Verifies the SKILL.md path applies use-case-aware overrides correctly.
2. Default bare CLI invocation: `--prompt "..."` with no other flags → 8s, 720p, audio on (regression for the CLI/library default — confirms no use-case override has leaked into the library default chain)
3. Marketing with audio on (dialogue + SFX present in output audio track)
4. 1080p forces duration=8 (auto-fix observable in Phase 4 PRESENT log)
5. 4K + 8s (new capability succeeds)
6. `negativePrompt` excludes targeted element (qualitative check)
7. `enhancePrompt=false` produces visibly different output from `enhancePrompt=true` with same prompt
8. Veo 2 audio handling — two distinct cases (rules at §3 #3 and Auto-corrections table):
   - (8a) `--model veo-2.0-generate-001` with no `--audio` flag → auto-fix sets `generateAudio=false` and emits "Veo 2 doesn't support audio, disabled" in `autoFixMessages`. Generates successfully. (Cost-bearing.)
   - (8b) `--model veo-2.0-generate-001 --audio` (explicit) → hard error "Veo 2 does not support audio. Pass `--no-audio` or switch to a Veo 3 model." (No-cost — rejected before the API call.)
9. Lite model generates successfully at lower cost (cost log captured)

PR description includes the checklist with checkmarks and links to generated videos.

### Pricing oracle review

At each release, the maintainer re-reads the official pricing URL and confirms the lookup table is current. The "Last updated" comment in `pricing.ts` is the audit trail.

## Resolved decisions

These were Open Questions in earlier revisions of the spec and have been resolved through documentation review or explicit user direction. Kept here as audit trail:

- **Default model ID** (last verified 2026-06-16): `veo-3.1-generate-001` (GA since 17 Nov 2025; falls back to `veo-3.1-fast-generate-001` in the same generation). The earlier draft of this spec used `veo-3.1-generate-preview` because the GA didn't exist yet; the preview is superseded by the GA `001` variant. `veo-3.0-generate-001` was the original fallback but is **deprecated** (discontinuation 30 Jun 2026) — kept in `AVAILABLE_MODELS` for backwards-compat only, not used as a default.
- **`sampleCount` upper bound** (Open Question #3 — closed 2026-06-16): Vertex AI docs explicitly state "Maximum number of output videos per prompt: 4" for all Veo 3.x GA models. `MODEL_SAMPLE_MAX = 4` for Veo 3.x, `2` for Veo 2. The earlier "1 per request" was from the narrower Gemini API surface, not Vertex AI.
- **Veo 2 allowed durations** (Open Question #4 — closed 2026-06-16): the Gemini API doc now lists `{5, 6, 8}` (NOT 7 as the spec had provisional). `MODEL_DURATIONS.get("veo-2.0-generate-001") = new Set([5, 6, 8])`. Veo 2 itself is deprecated, so the probe pass originally budgeted at ~$180 is no longer required — both Open Questions #3 and #4 are closed by the published docs.
- **`personGeneration` Vertex AI values**: Vertex uses `disallow` (not `dont_allow` as in Gemini API). Spec aligned to Vertex since that's our target API.
- **`referenceImages` wire shape**: each entry is `{ referenceType: "asset", image: VertexImage }`, not bare `{ image: VertexImage }`. Confirmed against the Vertex AI Veo 3.1 docs 2026-06-16.
- **API surface choice**: this plugin targets Vertex AI's `predictLongRunning` endpoint, not the Gemini API's. The two surfaces share the same logical models but use different model IDs (`*-001` on Vertex AI, `*-preview` on Gemini API as of 2026-06-16). Foundation's `AVAILABLE_MODELS` therefore lists only Vertex AI IDs; users passing a Gemini API ID via `--model` (e.g. `veo-3.1-generate-preview`) will see a 404 from Vertex AI. The Vertex AI `*-preview` IDs that used to exist (e.g. `veo-3.1-fast-generate-preview`) were discontinued 2 Apr 2026 and are not kept for backwards-compat — the GA `*-001` replacements have been available since 17 Nov 2025 and the discontinued IDs have been EOL for over 2 months. Cross-API portability is out of scope for Foundation; if needed, it's a future sub-project.
- **Import strategy**: `@veo-core/*` path alias via `tsconfig-paths`, registered programmatically by `bootstrap.ts` (not via `NODE_OPTIONS` — shebangs and CWD-relative resolution made that approach unreliable).
- **Validation composition**: `createValidator({ baseRules, extraRules })` factory pattern (not a global `registerRule()` registry). Avoids module-load order coupling, cross-skill leakage, and test-order dependence.
- **Token counting** (rule #5) **never hard-rejects**: verified Veo has no `countTokens` endpoint. See rule #5 description and Open Question #2 for the script-aware heuristic that powers the soft warning.
- **Output destination**: `outputPath` lives on `VeoConfig` (not as a separate `generateVideo` argument); rule #9 enforces that exactly one of `outputPath` / `storageUri` is set.
- **Image input shape**: `ImageInput` and `VertexImage` types pinned in §1 to prevent downstream sub-project divergence.
- **`downloadFile` error handling**: explicit HTTP status validation (non-2xx/3xx throws with status + body) + partial-file cleanup on error.
- **Authentication**: `google-auth-library` npm package (not shelling out to `gcloud` CLI). Native support for Service Accounts / ADC / Workload Identity; works in containers and CI.
- **SemVer bump 1.0.0 → 2.0.0** (CodeRabbit raised 2026-06-16): Foundation changes `generateVideo()`'s public signature from `(config, outputPath)` to `(config)` and shifts the audio default. SemVer 2.0.0 §8 requires MAJOR for incompatible API changes regardless of mitigation quality. An earlier draft proposed `1.1.0` on the basis that override flags + CHANGELOG were sufficient; that interpretation conflates *user-friendliness* with *API compatibility*. Major bump is the honest signal.

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
   | CJK (`一–鿿` U+4E00–U+9FFF, `぀–ヿ` U+3040–U+30FF, `가–힯` U+AC00–U+D7AF, CJK Symbols/Punctuation `　–〿` U+3000–U+303F, Halfwidth/Fullwidth Forms `＀–￯` U+FF00–U+FFEF) | 0.5 | Conservative value for token estimation: 1 char ≈ 2 tokens. Modern CJK tokenizers are increasingly efficient (sometimes approaching 1 token per char), so 0.5 chars/token is a safe upper bound that may over-estimate slightly — appropriate for a soft warning trigger that prefers spurious warnings to silent over-the-limit prompts. The Symbols/Punctuation and Fullwidth blocks are included so mixed CJK prose (which uses `、。「」` and fullwidth `ＡＢＣ` constructs) is not misclassified as Latin and undercounted. (Earlier draft said 1.0 "over-counts safely" — that was a math error: with `tokens ≈ chars/ratio`, a *smaller* ratio means *higher* estimated tokens, so 1.0 would have under-counted.) |
   | Cyrillic (`Ѐ–ӿ`) | 2.0 | Conservative; varies by word morphology |
   | Arabic (`؀–ۿ`) | 2.0 | Conservative |
   | Hebrew (`֐–׿`) | 2.0 | Conservative |
   | Devanagari (`ऀ–ॿ`) | 1.8 | Conservative for Hindi/Sanskrit |
   | Emoji / pictographs (Misc Symbols & Pictographs `U+1F300–U+1F5FF`, Emoticons `U+1F600–U+1F64F`, Supplemental Symbols & Pictographs `U+1F900–U+1F9FF`, Transport & Map `U+1F680–U+1F6FF`, Misc Symbols `U+2600–U+26FF`, Dingbats `U+2700–U+27BF`) | 0.4 | Modern tokenizers fall back to byte-level encoding for most emoji codepoints — typically 2–4 tokens per emoji (a single 4-byte UTF-8 emoji can become 4 tokens). Ratio of 0.4 chars/token reflects ~2.5 tokens per emoji as a conservative average. Without this row, an emoji-heavy prompt (e.g. social-media tags, reaction strings) classified as Latin (3.5 chars/token) underestimates by ~10× — a 100-emoji string would be flagged at ~29 tokens when it actually consumes ~250. |

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
3. **`enhancePrompt` REST parameter name**: the Vertex AI Veo docs describe a "prompt rewriter" toggle in Media Studio (UI control), and Foundation exposes a `enhancePrompt` field on `VeoConfig` based on the original Gemini API surface. The exact REST parameter name on Vertex AI's `predictLongRunning` endpoint isn't explicitly documented in the per-model pages as of 2026-06-16 — it could be `enhancePrompt`, `promptRewriter`, or something else. Verify empirically during implementation: try `enhancePrompt: false` against `veo-3.1-generate-001` and check the produced output is visibly different from the same prompt with the field unset (rewriter enabled by default). If the field name differs, update `buildRequestBody`.

## Risks & contingency

**Scope risk — Foundation bundles 3 concerns**: refactor lib, params+models+validation, audio context-aware system. Agent review flagged this as a possible scope-creep risk. Mitigation: if during implementation any of these sub-systems drifts past the planned size (e.g., audio context-aware requires more workflow rewriting than estimated), the implementer is authorized to split Foundation into two PRs without re-running this brainstorming step:

- **Foundation-A**: shared lib refactor + cross-cutting parameters + validation + image plumbing + 4K + model expansion. *Unblocks all four downstream sub-projects.*
- **Foundation-B**: audio context-aware default + audio lexicon + Phase 1/2/3 workflow rewrites. *Can ship in parallel with `/veo-animate` or `/veo-interpolate`.*

The split is a contingency, not the default plan. Default is single PR. The implementer makes the call based on actual PR size when work is ~70% complete.

## Migration plan

1. **Root infrastructure setup**: add root `package.json` with `vitest`, `ts-node`, `typescript`, `@types/node` (devDeps) and `google-auth-library`, `@google-cloud/storage`, `tsconfig-paths` (deps — all used at runtime by scripts); **commit `package-lock.json`** alongside `package.json` (required because the CI workflow uses `npm ci`, which fails without a committed lockfile); add root `tsconfig.json` declaring the `@veo-core/*` path alias → `skills/_shared/veo-core/*`; add `vitest.config.ts` referencing the same `tsconfig.json` so tests resolve the alias; add `skills/_shared/veo-core/bootstrap.ts` (see Architecture) registering `tsconfig-paths` programmatically with `findRepoRoot()`; add `.github/workflows/test.yml` running `npm ci && npm test` on PRs to `main`; update `.gitignore` to include `node_modules/` and `coverage/` (NOT `package-lock.json` — it must be committed for `npm ci` to work). Verify a trivial test that imports a module via `@veo-core/*` alias passes in CI before proceeding.
2. Create `skills/_shared/veo-core/` with extracted modules (`auth.ts`, `api.ts`, `generate.ts`, `types.ts`, `constants.ts`); no behavioral change yet.
3. Add `image-helpers.ts` and `ImageInput` type — exported but not yet consumed by Foundation.
4. Refactor `skills/veo/scripts/veo-generate.ts` to import from `_shared`; verify regression via existing examples.
5. Refactor `skills/veo-multi-shot/scripts/veo-multi-generate.ts` similarly.
6. Add new cross-cutting parameters + CLI flags to `_shared` and `veo-generate.ts`.
7. Implement `validation.ts` with Foundation rules (#1–#10), exporting `FOUNDATION_RULES` array and the `createValidator({ baseRules, extraRules })` factory so sub-projects can compose their own validators without modifying Foundation.
8. Implement `pricing.ts` with verified table + dated header.
9. Smoke-test each entry in `AVAILABLE_MODELS` with a minimal text-to-video request to confirm the IDs are still active. Verify `enhancePrompt` REST parameter name (Open Question #3 below), the `referenceImages` `{referenceType, image}` wrap shape on `veo-3.1-generate-001`, and the **`sampleCount` ceiling for `veo-3.1-lite-generate-001`** (Preview tier — the GA doc citation in `MODEL_SAMPLE_MAX` does not formally cover Preview models; if the Lite probe with `sampleCount=4` succeeds, the GA value carries over; if it rejects, update the `// PROVISIONAL` entry in `constants.ts` and record in Resolved decisions). **Action on failure**: if any model in `AVAILABLE_MODELS` returns 404 / "model not found" / "deprecated" from the smoke test, remove it from `AVAILABLE_MODELS` *and* from `DEFAULT_MODEL_CHAIN` if present, then add an entry to Resolved decisions noting the removal date and the reason. The Veo 3.0 family (`veo-3.0-generate-001`, `veo-3.0-fast-generate-001`) carries an announced discontinuation date of **30 Jun 2026** — if Foundation implementation begins after that date, expect both to fail the smoke test and remove them up front; if it begins before, leave them in for backwards-compat callers who explicitly pass `--model veo-3.0-generate-001`, with the documented EOL date as the audit trail. **Budget**: ~7 generations × ~$2.50 = ~$17.50. The full probe pass originally budgeted at ~$180 was eliminated when Open Questions #3 and #4 were closed by Vertex AI doc updates (2026-06-16) — Veo 3.x GA `sampleCount` max and Veo 2 durations no longer need empirical verification (only the Lite-tier gap remains).
10. Update `skills/veo/SKILL.md`: new params section, audio context-aware logic, updated workflow phases, new model decision table. **Extend Phase 1 USE CASE enum** to: `hero-background | marketing | social | product | ambient | loop | storytelling` — adding `loop` and `storytelling` so the audio default table in §2 has exact 1:1 enum matches.
11. Update `skills/veo/validation/prompt-checklist.md`: soften obsolete rules.
12. Write `skills/veo/references/audio-lexicon.md`.
13. Update `skills/veo/examples/` with audio prompt examples.
14. Write `CHANGELOG.md` documenting incompatible API changes; bump `plugin.json` version 1.0.0 → 2.0.0 (SemVer major — see §5 rationale).
15. Run manual integration checklist; record results in PR.

## Success criteria

- All existing `veo-generate.ts` example invocations from current README still succeed with identical output (modulo audio default change — explicitly documented).
- `wc -l skills/veo/scripts/veo-generate.ts` substantially smaller than the 595-line baseline (target: ~150 lines, accept up to ~200 if clarity demands). The metric is "did the refactor extract the right concerns into `_shared/`?", not a hard line budget.
- `wc -l skills/veo-multi-shot/scripts/veo-multi-generate.ts` substantially smaller, same intent as above.
- CI workflow runs on PR and fails when any unit test fails.
- 100% of rules in §3 have unit tests; `vitest` reports pass on a clean checkout.
- Manual integration checklist passes 9/9.
- `/veo` SKILL.md documents every new parameter with at least one example.
- A subsequent sub-project (e.g., `/veo-animate`) can be added by creating only a new skill folder + thin CLI, importing all infrastructure from `_shared/veo-core/`.
