# Release Notes

User-facing notes for each `veo-tools` release, newest first. Each entry links to the full per-version notes under [`docs/releases/`](docs/releases/). For the technical change log (Keep a Changelog format), see [`CHANGELOG.md`](CHANGELOG.md).

---

## 2.0.0 — "Foundation" (2026-06-17)

Sub-project 1 of 5 in the Veo improvements roadmap. Extracts a shared `@veo-core/*` library, adds the previously-missing cross-cutting Veo API parameters, makes the audio default context-aware, and centralizes configuration validation so bad requests fail before a paid API call. Targets Vertex AI; verified live against the API.

**Breaking** (major release):
- `generateVideo(config, outputPath)` → `generateVideo(config)` — output destination (`outputPath` or `storageUri`) now lives in the config.
- Audio default changed from always-off to context-aware (on for most use cases). Restore the old behavior with `--no-audio` / `generateAudio: false`.

**Highlights**: new parameters (`negativePrompt`, `seed`, `sampleCount`, `personGeneration`, `storageUri`, watermark, RAI reason, 4K) · 13-rule `validateConfig` with auto-fixes · cost estimation + `--dry-run` preview · hardened downloads · CI runs `tsc --noEmit` + a comprehensive unit-test suite.

→ Full notes, migration guide, and known limitations: [`docs/releases/2.0.0.md`](docs/releases/2.0.0.md)

---

## 1.0.0 — Initial release (2025-05-23)

First release of the `veo-tools` plugin for Claude Code.
