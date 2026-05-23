# Veo Foundation — Design Spec

**Date**: 2026-05-23
**Status**: Approved (pending user review)
**Scope**: Foundation sub-project (1 of 5 in the Veo improvements roadmap)
**Authors**: Giuseppe Iuculano + Claude

---

## Context

The `veo-tools` plugin currently exposes a 6-phase workflow for Google Veo 3.1 via Vertex AI, with two skills (`/veo`, `/veo-multi-shot`) plus support skills (`/veo-setup`, `/video-loop`). An audit of the official Veo documentation (`ai.google.dev/gemini-api/docs/video`, Vertex AI Veo docs, and prompt guides) revealed significant gaps between the API's capabilities and the plugin's implementation:

- Missing input modalities: image-to-video, frame interpolation, video extension, reference images
- Missing API parameters: `negativePrompt`, `enhancePrompt`, `storageUri`, `personGeneration`
- Missing models: Veo 3.1 Lite, Veo 3 stable, Veo 2
- Missing resolution: 4K
- Audio nativo treated as second-class (default off, no prompt guidance) despite being a killer feature of Veo 3+
- No cross-parameter validation (e.g., 1080p requires duration=8)
- Code duplication between `veo-generate.ts` and `veo-multi-generate.ts` blocking new skills

The full roadmap (chosen Approach A — staged by capability) is decomposed into 5 sub-projects:

1. **Foundation** *(this spec)* — shared library + cross-cutting parameters + audio context-aware + validation
2. `/veo-animate` — image-to-video
3. `/veo-interpolate` — first frame + last frame
4. `/veo-extend` — video extension up to ~148s
5. `/veo-multi-shot v2` — integrate `referenceImages` for character/product consistency

Foundation is the enabling block: the other four sub-projects depend on the shared library and parameters defined here.

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
- Foundation must reduce per-script line count from ~600 to ~80 by extracting shared code.
- New skills (`/veo-animate` etc.) must be implementable by writing only a CLI + workflow, not new auth/polling/validation code.
- Audio nativo becomes a first-class option when use case warrants it, never silently lost when use case warrants it.

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
      pricing.ts                    # estimateCost(config) per model × resolution × duration × audio
      types.ts                      # VeoConfig, GenerationResult, InputMode, ValidationResult
      constants.ts                  # MODELS, REGIONS, MAX_TOKENS, MAX_REFERENCE_IMAGES
      tsconfig.json                 # ES target, paths
  veo/
    scripts/
      veo-generate.ts               # thin CLI wrapper (~80 lines, was 595)
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

The `_shared/` directory uses an underscore prefix so the Claude Code skill loader does not treat it as a skill (skill loader scans `*/SKILL.md`). Each consuming skill references it via relative imports plus a tsconfig path mapping (`@veo-core/*`) to keep imports readable and refactor-safe.

### Module boundaries

| Module | Public API | Internal |
|---|---|---|
| `auth.ts` | `getAccessToken(): string` | gcloud CLI invocation, error normalization |
| `api.ts` | `submitGeneration(config, token): Promise<operationName>`, `pollOperation(opName, token): Promise<status>`, `downloadFile(url, path, token): Promise<void>` | URL building, HTTPS request handling, redirect following |
| `generate.ts` | `generateVideo(config: VeoConfig, outputPath: string): Promise<GenerationResult>` | orchestrates auth → validate → submit → poll → download |
| `validation.ts` | `validateConfig(config: VeoConfig): ValidationResult` | rule registry, auto-fix logic |
| `pricing.ts` | `estimateCost(config: VeoConfig): { usd: number; breakdown: string }` | lookup table, last-updated marker comment |
| `types.ts` | exports type definitions only | — |
| `constants.ts` | exports frozen objects/arrays | — |

### Data flow

```
CLI (veo-generate.ts)
  └─> parseArgs → VeoConfig
        └─> generateVideo(config, outputPath)
              ├─> validateConfig(config) → may throw or auto-fix
              ├─> getAccessToken()
              ├─> submitGeneration(config, token) → operationName
              ├─> pollOperation(operationName, token) → status
              └─> downloadFile(status.videoUrl, outputPath, token)
        └─> GenerationResult
```

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
| `model` | enum | expanded list (see below) | `veo-3.1-generate-preview` (pending empirical verification) | |

#### Model expansion

| Model ID | Variant | Use case | Audio | Max resolution |
|---|---|---|---|---|
| `veo-3.1-generate-preview` | Veo 3.1 quality (preview) | Default quality | yes | 4K |
| `veo-3.1-fast-generate-preview` | Veo 3.1 fast | Fast iteration | yes | 4K |
| `veo-3.1-lite-generate-preview` | Veo 3.1 lite | Lowest cost, text/image-to-video only | yes | 1080p |
| `veo-3.0-generate-001` | Veo 3 stable | Production with audio | yes | 4K |
| `veo-3.0-fast-generate-001` | Veo 3 fast stable | Production fast iteration | yes | 4K |
| `veo-2.0-generate-001` | Veo 2 | Silent video, multi-sample | **no** | 720p |

The current default `veo-3.1-generate-001` does not appear in official docs and may be invalid. Foundation includes empirical verification: during implementation, test which IDs return successfully from `predictLongRunning`. Default falls back to the most-recent confirmed-working ID, with preference for stable over preview when both work.

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

Anti-patterns rejected by Phase 3 VALIDATE:
- Audio on but no audio descriptors in prompt → warning
- Comic-book onomatopoeia (`BAM!`, `WHOOSH!`) → rejected; suggest realistic description
- Dialogue without quotes → rejected

New file `skills/veo/references/audio-lexicon.md` contains:
- Professional SFX vocabulary (Foley terms)
- Dialogue patterns that fit 8s (~25 words max)
- Ambient patterns per mood (industrial, organic, cinematic)
- Known limit: voice does not extend if absent in last 1s (relevant to future `/veo-extend`)

### 3. Cross-parameter validation rules

`validation.ts` centralizes API constraint validation, separate from prompt-quality rules (which remain in `validation/prompt-checklist.md`).

| # | Rule | Error if violated |
|---|---|---|
| 1 | `resolution ∈ {1080p, 4k}` ⇒ `durationSeconds == 8` | "1080p/4K require duration=8" |
| 2 | `referenceImages` present ⇒ `durationSeconds == 8` | "Reference images require duration=8" |
| 3 | `lastFrame` present ⇒ `durationSeconds == 8` AND `image` present | "Interpolation requires both image and lastFrame, duration=8" |
| 4 | Video extension ⇒ `resolution == 720p` | "Video extension only supports 720p" |
| 5 | `model ∈ veo-2.*` ⇒ `generateAudio == false` | "Veo 2 doesn't support audio" |
| 6 | `model ∈ veo-2.*` ⇒ `resolution == 720p` | "Veo 2 max resolution is 720p" |
| 7 | `model ∈ veo-3.1-lite-*` ⇒ no `referenceImages`, no extension | "Lite model doesn't support reference images or extension" |
| 8 | `referenceImages.length ∈ [1, 3]` | "Reference images must be 1-3" |
| 9 | `prompt.tokens > 1024` (approx: chars / 3.5) | "Prompt exceeds 1024 tokens" |
| 10 | `personGeneration == allow_all` in EU/UK/CH/MENA region | Auto-correct + warning: "Region restriction: falling back to allow_adult" |
| 11 | `sampleCount ∈ [1, model-max]` (see Open Questions) | "sampleCount out of range for selected model" |
| 12 | `aspectRatio ∈ {16:9, 9:16}` only | "Invalid aspect ratio" |

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
  - Audio Layer added: ambient soundscape

Validation: PASSED (3 warnings)
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

Plugin version in `.claude-plugin/plugin.json` bumps minor (0.x → 0.(x+1).0). New `CHANGELOG.md` documents each behavioral change.

### 6. Pricing strategy

`pricing.ts` exposes `estimateCost(config: VeoConfig): { usd: number; breakdown: string }`. Implementation:

```typescript
// pricing.ts
// Last updated: 2026-05-23
// Source: <official pricing URL — to be filled at implementation time>
// REVIEW BEFORE EACH RELEASE
const PRICING = { ... } as const
```

The source URL and review-on-release invariant are encoded as file-level comments. Pricing is a manually-maintained lookup table per model × resolution × audio. Estimate displayed in Phase 4 PRESENT with breakdown.

Automatic pricing-API integration is out of scope; pricing remains manual until enough churn justifies automation.

## Testing strategy

### Unit tests (free, deterministic)

Run on every PR; mock or pure functions only.

- `validation.test.ts` — every rule in §3 with valid + invalid input
- `pricing.test.ts` — full matrix model × resolution × duration × audio
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
2. **Region detection**: rule #10 requires knowing user's region. Options: explicit user flag (`--region eu`), env var (`VEO_REGION`), or omit and let API return the error. Foundation will use env var with fallback to relying on API error message — explicit detection is over-scope.
3. **Token counting**: Foundation uses `chars / 3.5` approximation for rule #9. Accurate counting requires an extra API call; deferred to future iteration unless this rule fires often in practice.
4. **`sampleCount` upper bound per model**: official docs are contradictory — the main Veo page states "Veo 2 supports 2; Veo 3+ generates 1", while the `veo-3.1-generate-preview` model page states "Max output videos: 4 per request". The current script accepts 1-4 universally. Foundation defers the authoritative answer to empirical verification: probe each model with `sampleCount=2,3,4` and encode the discovered limits as a per-model constant in `constants.ts`.

## Migration plan

1. Create `skills/_shared/veo-core/` with extracted modules; no behavioral change yet.
2. Refactor `skills/veo/scripts/veo-generate.ts` to import from `_shared`; verify regression via existing examples.
3. Refactor `skills/veo-multi-shot/scripts/veo-multi-generate.ts` similarly.
4. Add new parameters + CLI flags to `_shared` and `veo-generate.ts`.
5. Implement `validateConfig()` with all rules from §3.
6. Implement `pricing.ts` with verified table.
7. Update `skills/veo/SKILL.md`: new params section, audio context-aware logic, updated workflow phases, new model decision table.
8. Update `skills/veo/validation/prompt-checklist.md`: soften obsolete rules.
9. Write `skills/veo/references/audio-lexicon.md`.
10. Update `skills/veo/examples/` with audio prompt examples.
11. Write `CHANGELOG.md` documenting behavioral changes.
12. Run manual integration checklist; record results in PR.

## Success criteria

- All existing `veo-generate.ts` example invocations from current README still succeed with identical output (modulo audio default change — explicitly documented).
- `wc -l skills/veo/scripts/veo-generate.ts` < 150 lines after refactor (was 595).
- `wc -l skills/veo-multi-shot/scripts/veo-multi-generate.ts` < 150 lines after refactor.
- 100% of rules in §3 have unit tests.
- Manual integration checklist passes 8/8.
- `/veo` SKILL.md documents every new parameter with at least one example.
- A subsequent sub-project (e.g., `/veo-animate`) can be added by creating only a new skill folder + thin CLI, importing all infrastructure from `_shared/veo-core/`.
