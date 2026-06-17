# Changelog

All notable changes to `veo-tools` are documented here. Format: [Keep a Changelog](https://keepachangelog.com/). SemVer.

## [2.0.0] — 2026-06-17

### BREAKING
- **`generateVideo` signature change**: was `generateVideo(config, outputPath)`, now `generateVideo(config)` with `outputPath` (or `storageUri`) living inside `VeoConfig`. Validation rule #9 enforces exactly one of the two.
- **Audio default change**: was `generateAudio: false` by default, now context-aware. When Phase 1 USE CASE is `hero-background`, `ambient`, or `loop`, audio defaults to off; for `social`, `marketing`, `product`, `storytelling`, or unspecified use case, audio defaults to on (matching Veo 3.1 API native default). Restore the previous behaviour with `--no-audio`.

### Added
- `skills/_shared/veo-core/` shared library (types, constants, auth, image-helpers, pricing, api, validation, generate, bootstrap).
- 7-value Phase 1 USE CASE enum: `hero-background | marketing | social | product | ambient | loop | storytelling` (added `loop` and `storytelling`).
- Cross-cutting parameters and CLI flags: `--negative-prompt`, `--enhance-prompt` / `--no-enhance-prompt`, `--seed`, `--sample-count`, `--person-generation`, `--storage-uri`, `--add-watermark` / `--no-add-watermark`, `--include-rai-reason`.
- `FOUNDATION_RULES` (11 rules) + `createValidator({baseRules, extraRules})` factory. Rule #11 (Veo 3 cannot disable prompt enhancement) was added from the M13 probe-pass finding below.
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

### Verified live (M13 probe pass, 2026-06-17, project `claude-ve` / `us-central1`)
- **All 6 `AVAILABLE_MODELS` are live** and generate valid MP4s: `veo-3.1-generate-001`, `veo-3.1-fast-generate-001`, `veo-3.1-lite-generate-001`, `veo-3.0-generate-001`, `veo-3.0-fast-generate-001`, `veo-2.0-generate-001`. None removed (Veo 3.0 family still active ahead of its 30 Jun 2026 discontinuation).
- **Default delivery shape**: with no `storageUri`, `predictLongRunning` returns the video inline as `response.videos[0].bytesBase64Encoded` + `mimeType` — *not* a `uri`/`gcsUri`. The unit-test mocks had assumed `uri`; `pollOperation` + `generateVideo` now handle the inline base64 path (decode + atomic write). This was the most common path and was previously broken.
- **`MODEL_SAMPLE_MAX['veo-3.1-lite-generate-001'] = 4`** confirmed (Preview tier accepts `sampleCount=4`); the `// PROVISIONAL` marker is removed.
- **`enhancePrompt` is locked on for Veo 3**: Vertex rejects `enhancePrompt=false` on Veo 3 models ("Veo 3 prompt enhancement cannot be disabled"). New validation **rule #11** surfaces this before the paid API call; `--no-enhance-prompt` is documented as Veo 2-only.
- `referenceImages` wire shape (`{referenceType:'asset', image}`) is asserted in `api.test.ts`; the paid wire test is deferred to `/veo-multi-shot v2`, which owns that parameter.

## [1.0.0] — 2025-05-23

Initial release.
