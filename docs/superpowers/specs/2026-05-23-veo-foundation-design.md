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
- Foundation must reduce per-script line count from ~600 to <150 by extracting shared code (target aligned with Success criteria).
- New skills (`/veo-animate` etc.) must be implementable by writing only a CLI + workflow, not new auth/polling/validation code.
- Audio native becomes a first-class option when use case warrants it, never silently lost when use case warrants it.

**Non-goals**
- Multi-provider abstraction (no Veo-vs-other-model swap layer).
- Web UI or web API server.
- Automated cost optimization (e.g., auto-switch to Fast if budget exceeded).

## Architecture

### Directory layout

```
skills/
  _shared/                          # NEW — non-skill code (underscore prefix excludes from skill loader)
    veo-core/
      auth.ts                       # getAccessToken() — single source of truth
      api.ts                        # makeRequest, downloadFile, polling
      generate.ts                   # generateVideo(config) — unified entry
      validation.ts                 # validateConfig(config) — cross-parameter rules
      pricing.ts                    # estimateCost(config) per model × resolution × duration × audio × sampleCount
      types.ts                      # VeoConfig, GenerationResult, InputMode, ValidationResult, ImageInput
      image-helpers.ts              # MIME validation, base64 encoding, GCS upload helpers (used by future sub-projects)
      constants.ts                  # MODELS, REGIONS, MAX_TOKENS, MAX_REFERENCE_IMAGES
      tsconfig.json                 # ES target, paths
  veo/
    scripts/
      veo-generate.ts               # thin CLI wrapper (<150 lines, was 595)
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

Consuming skills reference `_shared/` via **relative imports** (e.g., `import { generateVideo } from '../../_shared/veo-core/generate'`). The original draft proposed a tsconfig path alias `@veo-core/*`, but the repository has no root `tsconfig.json` and the scripts run via `npx ts-node` without `--project`, so path aliases wouldn't resolve reliably. Relative imports are chosen for Foundation. If later sub-projects need cleaner imports, the team can introduce a root `tsconfig.json` + `TS_NODE_PROJECT` env var as a follow-up.

### Module boundaries

| Module | Public API | Internal |
|---|---|---|
| `auth.ts` | `getAccessToken(): string` | gcloud CLI invocation, error normalization |
| `api.ts` | `submitGeneration(config, token): Promise<operationName>`, `pollOperation(opName, token): Promise<status>`, `downloadFile(url, path, token): Promise<void>` | URL building, HTTPS request handling, redirect following, **explicit HTTP status validation** (non-2xx/3xx → throw with status + body), partial-file cleanup on error |
| `generate.ts` | `generateVideo(config: VeoConfig, outputPath?: string): Promise<GenerationResult>` | orchestrates auth → validate → submit → poll → (download \| skip if `storageUri` set). `outputPath` is required only when `storageUri` is unset. |
| `validation.ts` | `validateConfig(config: VeoConfig): ValidationResult` | rule registry, auto-fix logic |
| `pricing.ts` | `estimateCost(config: VeoConfig): { usd: number; breakdown: string }` | lookup table, last-updated marker comment |
| `image-helpers.ts` | `validateImage(input: ImageInput)`, `encodeImageBase64(path)`, `uploadImageToGcs(path, gcsUri)` | MIME sniffing, file I/O, GCS API |
| `types.ts` | exports type definitions only | — |
| `constants.ts` | exports frozen objects/arrays | — |

### Data flow

```
CLI (veo-generate.ts)
  └─> parseArgs → VeoConfig
        └─> generateVideo(config, outputPath?)
              ├─> validateConfig(config) → may throw or auto-fix
              ├─> getAccessToken()
              ├─> submitGeneration(config, token) → operationName
              ├─> pollOperation(operationName, token) → status
              └─> if config.storageUri:
              │     skip downloadFile — video already on GCS at storageUri
              │   else:
              │     downloadFile(status.videoUrl, outputPath, token)
              │       └─> validate HTTP status; throw on non-2xx/3xx
        └─> GenerationResult (videoPath set when downloaded; gcsUri set when storageUri used)
```

When `storageUri` is set, `outputPath` is ignored and `GenerationResult.gcsUri` carries the final location; `videoPath` is `undefined`. When `storageUri` is unset, the inverse holds. The CLI errors out if neither is provided.

## Detailed design

### 1. Cross-cutting parameters added to `/veo`

| Parameter | Type | Valid values | Default | Notes |
|---|---|---|---|---|
| `negativePrompt` | string | free text (no "no/don't") | `undefined` | List excluded elements, e.g., `"text overlays, logos, watermarks"` |
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

The current default `veo-3.1-generate-001` does not appear in official docs and may be invalid. Foundation includes empirical verification: during implementation, test which IDs return successfully from `predictLongRunning`.

**Default model selection rule** (final): prefer the **latest generation** that works (currently Veo 3.1 preview) so users get access to newest features by default. If the latest preview is unavailable for a given account/region, fall back to the latest stable variant (`veo-3.0-generate-001`). This means the default is `veo-3.1-generate-preview` if accessible, else `veo-3.0-generate-001`. Stable preference applies *within the same generation*, not across generations.

#### `VeoConfig` type schema — forward declarations

To prevent every downstream sub-project from modifying Foundation's type definitions, the `VeoConfig` interface in `types.ts` declares **all known Veo API input fields as optional from day one**, even those Foundation doesn't validate or consume:

```typescript
export interface VeoConfig {
  // Foundation-owned (validated and consumed here)
  prompt: string
  model?: string
  aspectRatio?: '16:9' | '9:16'
  durationSeconds?: number        // Foundation enforces {4,6,8} via validation; sub-projects (e.g., /veo-extend) may allow larger values
  resolution?: '720p' | '1080p' | '4k'
  generateAudio?: boolean
  sampleCount?: number
  seed?: number
  negativePrompt?: string
  enhancePrompt?: boolean
  storageUri?: string
  personGeneration?: 'allow_all' | 'allow_adult' | 'dont_allow'

  // Forward-declared (validation/semantics added by sub-projects)
  image?: ImageInput              // /veo-animate
  lastFrame?: ImageInput          // /veo-interpolate
  referenceImages?: ImageInput[]  // /veo-multi-shot v2
  videoExtensionInput?: string    // /veo-extend (operation name or GCS uri)
}
```

Foundation's `validateConfig()` ignores the forward-declared fields. Each sub-project adds rules via `registerRule()` (see §3) without modifying `VeoConfig`.

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
| `loop` (any) | off | Audio crossfade in loops introduces artifacts |
| `social` | on | Reels/TikTok/Shorts: audio primary |
| `marketing` | on | Promos, ads, brand stories |
| `product` | on | Showcase with SFX or voiceover |
| `storytelling` / multi-shot narrative | on | Dialogue + sync are the point |
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

### 3. Cross-parameter validation rules

`validation.ts` centralizes API constraint validation, separate from prompt-quality rules (which remain in `validation/prompt-checklist.md`).

Foundation only validates parameters that Foundation introduces. Rules covering input modalities (`image`, `lastFrame`, `referenceImages`, video extension) are **added by the sub-projects that own those parameters** — they appear in this table only as forward references, not as Foundation deliverables.

| # | Rule | Error if violated | Owned by |
|---|---|---|---|
| 1 | `resolution ∈ {1080p, 4k}` ⇒ `durationSeconds == 8` | "1080p/4K require duration=8" | Foundation |
| 2 | `model ∈ veo-2.*` ⇒ `generateAudio == false` | "Veo 2 doesn't support audio" | Foundation |
| 3 | `model ∈ veo-2.*` ⇒ `resolution == 720p` | "Veo 2 max resolution is 720p" | Foundation |
| 4 | `prompt.tokens > 1024` (approx: chars / 3.5 for Latin-script; see note below) | **Warning** when estimated tokens > 900 (soft); **Reject** only when estimated > 1024 (hard ceiling) — see token counting note | Foundation |
| 5 | `personGeneration == allow_all` in EU/UK/CH/MENA region (see Open Question #2 for detection mechanism) | Auto-correct + warning: "Region restriction: falling back to allow_adult" | Foundation |
| 6 | `sampleCount ∈ [1, model-max]` (see Open Question #4) | "sampleCount out of range for selected model" | Foundation |
| 7 | `aspectRatio ∈ {16:9, 9:16}` only | "Invalid aspect ratio" | Foundation |
| F1 | `image` present ⇒ `durationSeconds == 8` (image-to-video) | — | `/veo-animate` |
| F2 | `lastFrame` present ⇒ `durationSeconds == 8` AND `image` present | — | `/veo-interpolate` |
| F3 | Video extension input ⇒ `resolution == 720p` | — | `/veo-extend` |
| F4 | `model ∈ veo-3.1-lite-*` ⇒ no `referenceImages`, no extension | — | `/veo-multi-shot v2` + `/veo-extend` |
| F5 | `referenceImages.length ∈ [1, 3]` | — | `/veo-multi-shot v2` |

The `validation.ts` rule registry is designed to accept additions: each sub-project adds its own rules without modifying Foundation rules. Foundation exposes a `registerRule(rule: ValidationRule)` API for this.

#### Auto-corrections

Applied with explicit user notification in Phase 4 PRESENT:

| Situation | Auto-fix | Message |
|---|---|---|
| `resolution=1080p/4k` + `duration<8` (user didn't explicitly set duration) | Force `duration=8` | "Bumped duration to 8s to enable 1080p/4K" |
| Region=EU + `personGeneration=allow_all` | Force `allow_adult` | "Region restriction: personGeneration set to allow_adult" |
| `model=veo-2.*` + `audio=on` | Force `audio=off` | "Veo 2 doesn't support audio, disabled" |

Auto-fixes apply only when the corrected value is unambiguous. Ambiguous combinations (e.g., user explicitly set duration=6 AND resolution=1080p) fail with error instead.

#### `validateConfig()` signature

```typescript
type ValidationResult =
  | { valid: true; warnings: string[]; autoFixed?: VeoConfig }
  | { valid: false; errors: string[]; suggestions: string[] }

function validateConfig(config: VeoConfig): ValidationResult
```

Called from three locations:
- CLI: exits with code 1 on `valid: false`, prints errors + suggestions
- SKILL.md Phase 3 VALIDATE: surfaces warnings to user before Phase 4
- Programmatic: callers of `generateVideo()` get validation before API call

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
| Default model `veo-3.1-generate-001` → verified ID | **Possibly** (if current ID is invalid) | Empirical verification first; if both work, keep current as fallback |
| New `validateConfig()` rules with auto-fix | No | Auto-fix is additive; rejects only what API would reject anyway |
| Extended `VeoConfig` type | No | All new fields optional |

Plugin version in `.claude-plugin/plugin.json` is currently `1.0.0`. Foundation bumps it to `1.1.0` (semver minor — additive backwards-compatible features). The two behavioral changes (audio default, model ID resolution) are minor under semver because both have explicit override flags that restore prior behavior. New `CHANGELOG.md` (Keep-a-Changelog format) documents each change.

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
- **`package.json`**: introduce at repo root with `devDependencies: { vitest, typescript, @types/node }`, plus `scripts: { test: "vitest run", "test:watch": "vitest" }`.
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

## Open questions

1. **Default model ID**: `veo-3.1-generate-001` (current) vs `veo-3.1-generate-preview` (docs) — to be resolved empirically during implementation. If both work, prefer current for backwards compatibility; if only one works, choose that.
2. **Region detection**: rule #5 (`personGeneration` regional restriction) requires knowing the user's region for proactive auto-fix. Resolution is **two-tier**:

   - **Tier 1 — explicit `VEO_REGION` env var**: values `us`, `eu`, `uk`, `ch`, `mena`, `other`. Highest priority.
   - **Tier 2 — inferred from `GOOGLE_CLOUD_LOCATION`** (already used for Vertex AI endpoint URL). Mapping in `constants.ts`:
     - `us-*`, `northamerica-*` → `us`
     - `europe-*` → `eu` (further split into `uk` if `europe-west2`, `ch` if `europe-west6`)
     - `me-*` → `mena`
     - `asia-*`, `australia-*`, `southamerica-*` → `other`
   - If neither is set or the inference yields no match, auto-fix is skipped and the API error (if any) is surfaced verbatim in Phase 5 GENERATE.

   The inference is best-effort — users with multi-region setups can override via `VEO_REGION`.
3. **Token counting** (rule #4): heuristic varies by script. Foundation uses per-script multipliers detected via Unicode range scan, with conservative defaults to avoid underestimation:

   | Script range | Ratio (chars per token) | Notes |
   |---|---|---|
   | Latin (default) | 3.5 | Tuned for English; reasonable for most Western languages |
   | CJK (`一–鿿`, `぀–ヿ`, `가–힯`) | 1.5 | Each character often = multiple tokens |
   | Cyrillic (`Ѐ–ӿ`) | 2.0 | Conservative; varies by word morphology |
   | Arabic (`؀–ۿ`) | 2.0 | Conservative |
   | Hebrew (`֐–׿`) | 2.0 | Conservative |
   | Devanagari (`ऀ–ॿ`) | 1.8 | Conservative for Hindi/Sanskrit |

   Detection: count chars per script; the dominant range determines the multiplier (>30% threshold). Mixed prompts default to the most restrictive multiplier among present scripts. Mitigation tiers: (a) rule #4 acts as a **soft warning** at >900 estimated tokens, **hard reject** only at >1024 estimated; (b) when a non-Latin multiplier is used, the warning notes "estimate approximate for non-Latin content"; (c) Phase 5 API-side token errors are surfaced verbatim and tagged for the maintainer to revisit the ratios. Accurate token counting via an extra API call remains deferred until evidence justifies it.
4. **`sampleCount` upper bound per model**: official docs are contradictory — the main Veo page states "Veo 2 supports 2; Veo 3+ generates 1", while the `veo-3.1-generate-preview` model page states "Max output videos: 4 per request". The current script accepts 1-4 universally. Foundation defers the authoritative answer to empirical verification: probe each model with `sampleCount=2,3,4` and encode the discovered limits as a per-model constant in `constants.ts`.

## Risks & contingency

**Scope risk — Foundation bundles 3 concerns**: refactor lib, params+models+validation, audio context-aware system. Agent review flagged this as a possible scope-creep risk. Mitigation: if during implementation any of these sub-systems drifts past the planned size (e.g., audio context-aware requires more workflow rewriting than estimated), the implementer is authorized to split Foundation into two PRs without re-running this brainstorming step:

- **Foundation-A**: shared lib refactor + cross-cutting parameters + validation + image plumbing + 4K + model expansion. *Unblocks all four downstream sub-projects.*
- **Foundation-B**: audio context-aware default + audio lexicon + Phase 1/2/3 workflow rewrites. *Can ship in parallel with `/veo-animate` or `/veo-interpolate`.*

The split is a contingency, not the default plan. Default is single PR. The implementer makes the call based on actual PR size when work is ~70% complete.

## Migration plan

1. **Test infrastructure**: add root `package.json` with `vitest`, `typescript`, `@types/node` devDeps; add `.github/workflows/test.yml` running tests on PR. Verify a trivial test passes in CI before proceeding.
2. Create `skills/_shared/veo-core/` with extracted modules (`auth.ts`, `api.ts`, `generate.ts`, `types.ts`, `constants.ts`); no behavioral change yet.
3. Add `image-helpers.ts` and `ImageInput` type — exported but not yet consumed by Foundation.
4. Refactor `skills/veo/scripts/veo-generate.ts` to import from `_shared`; verify regression via existing examples.
5. Refactor `skills/veo-multi-shot/scripts/veo-multi-generate.ts` similarly.
6. Add new cross-cutting parameters + CLI flags to `_shared` and `veo-generate.ts`.
7. Implement `validation.ts` with Foundation rules (#1–#7) and the `registerRule()` API for future sub-project rules.
8. Implement `pricing.ts` with verified table + dated header.
9. Empirical verification of Open Questions #1 (default model ID) and #4 (`sampleCount` per model); update `constants.ts`.
10. Update `skills/veo/SKILL.md`: new params section, audio context-aware logic, updated workflow phases, new model decision table.
11. Update `skills/veo/validation/prompt-checklist.md`: soften obsolete rules.
12. Write `skills/veo/references/audio-lexicon.md`.
13. Update `skills/veo/examples/` with audio prompt examples.
14. Write `CHANGELOG.md` documenting behavioral changes; bump `plugin.json` version 1.0.0 → 1.1.0.
15. Run manual integration checklist; record results in PR.

## Success criteria

- All existing `veo-generate.ts` example invocations from current README still succeed with identical output (modulo audio default change — explicitly documented).
- `wc -l skills/veo/scripts/veo-generate.ts` < 150 lines after refactor (was 595).
- `wc -l skills/veo-multi-shot/scripts/veo-multi-generate.ts` < 150 lines after refactor.
- CI workflow runs on PR and fails when any unit test fails.
- 100% of rules in §3 have unit tests; `vitest` reports pass on a clean checkout.
- Manual integration checklist passes 8/8.
- `/veo` SKILL.md documents every new parameter with at least one example.
- A subsequent sub-project (e.g., `/veo-animate`) can be added by creating only a new skill folder + thin CLI, importing all infrastructure from `_shared/veo-core/`.
