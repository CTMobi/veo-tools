# Veo - AI Video Generation Skills for Claude Code

Generate cinematic video content using Google Veo on Vertex AI — Veo 3.1 by default, with the older Veo 3.0/2.0 models selectable via `--model`. Produce single-shot clips (hero backgrounds, marketing materials, ambient looping visuals) with the `veo` skill, and cohesive multi-clip narrative videos (18-60s, marketing/brand stories/product launches) with the `veo-multi-shot` skill.

This is the **2.0.0 "Foundation"** release. The skills are now built on a shared `@veo-core/*` TypeScript library that handles authentication, configuration validation, cost estimation, and generation. See [`docs/releases/2.0.0.md`](docs/releases/2.0.0.md) and [`CHANGELOG.md`](CHANGELOG.md) for the full release notes — including the breaking `generateVideo(config)` signature change and the new context-aware audio default (see [Breaking changes](#breaking-changes-in-200)).

## Example Output

### Single-Shot: Hero Background Loop

A seamless looping abstract background for website hero sections.

[![Hero Loop Example](docs/thumbnails/hero-loop.jpg)](https://github.com/CTMobi/veo-tools/releases/latest/download/hero-loop.mp4)

*Click to download video*

### Multi-Shot: Marketing Launch Video

A 4-shot promotional video assembled from individually generated clips using `/veo-multi-shot`.

[![Multi-Shot Assembled](docs/thumbnails/multi-shot-assembled.jpg)](https://github.com/CTMobi/veo-tools/releases/latest/download/dataflow-launch-assembled.mp4)

*Click to download video*

<details>
<summary>View individual shots</summary>

| Shot 1: Teaser | Shot 2: Reveal |
|:---:|:---:|
| [![Shot 1](docs/thumbnails/shot-01-teaser.jpg)](https://github.com/CTMobi/veo-tools/releases/latest/download/shot-01-teaser.mp4) | [![Shot 2](docs/thumbnails/shot-02-reveal.jpg)](https://github.com/CTMobi/veo-tools/releases/latest/download/shot-02-reveal.mp4) |

| Shot 3: Detail | Shot 4: Context |
|:---:|:---:|
| [![Shot 3](docs/thumbnails/shot-03-detail.jpg)](https://github.com/CTMobi/veo-tools/releases/latest/download/shot-03-detail.mp4) | [![Shot 4](docs/thumbnails/shot-04-context.jpg)](https://github.com/CTMobi/veo-tools/releases/latest/download/shot-04-context.mp4) |

</details>

---

## Installation

### Option 1: Plugin Marketplace (Recommended)

```bash
/plugin marketplace add CTMobi/veo-tools
/plugin install veo-tools
```

### Option 2: Manual Copy

This is now an npm project: the skills import from a shared `@veo-core/*` library that is resolved at runtime by `skills/_shared/veo-core/bootstrap.ts`, which walks up the tree to find the repo root (marked by `.claude-plugin/plugin.json`) and registers the `@veo-core/*` → `skills/_shared/veo-core/*` path mapping at runtime. The mapping is hardcoded in `bootstrap.ts` (via `tsconfig-paths`); `tsconfig.json` carries the same alias only for the TypeScript compiler, and is not read at runtime. The library also needs the root runtime dependencies (`google-auth-library`, `@google-cloud/storage`, `tsconfig-paths`).

Because of this, you must install the **whole repository** — not just `skills/*` — and run `npm install` at the repo root before any script runs:

```bash
# Clone the repository
git clone https://github.com/CTMobi/veo-tools.git
cd veo-tools

# Install runtime + dev dependencies (required)
npm install
```

To install the skills into Claude Code, the cleanest path is **Option 1** above (`/plugin marketplace add`) — it avoids manual path issues entirely. If you do install manually, point Claude Code at this checkout (after `npm install`); do **not** copy the repo folder *into* your skills directory, which nests the skills under an extra level so Claude Code can't discover them, and do **not** copy `skills/*` alone — that breaks at runtime: `bootstrap.ts` throws `could not locate repo root` when `.claude-plugin/plugin.json` is missing, and the `@veo-core` dependencies are absent.

## Skills Included

| Skill | Command | Description |
|-------|---------|-------------|
| `veo` | `/veo` | Generate single-shot AI videos with cinematic prompt engineering |
| `veo-multi-shot` | `/veo-multi-shot` | Generate cohesive multi-clip videos (18-60s) with locked Visual DNA |
| `veo-setup` | `/veo-setup` | Configure Google Cloud project and authentication |
| `video-loop` | `/video-loop` | Create seamless infinite loops from any video |

`@veo-core` (`skills/_shared/veo-core/`) is the shared infrastructure library behind the `veo` and `veo-multi-shot` skills (auth, validation, cost estimation, generation). It is not a slash command.

## How the Veo Skill Works

The `/veo` skill follows a **6-phase workflow** designed to prevent bad prompts and invalid configs from reaching expensive API calls:

```text
User Request → UNDERSTAND → CRAFT → VALIDATE → PRESENT → GENERATE → ITERATE
```

### Phase 1: UNDERSTAND
Claude gathers context before crafting any prompt:

- **USE CASE**: `hero-background` | `marketing` | `social` | `product` | `ambient` | `loop` | `storytelling`
- **MOOD** and visual direction
- **TECHNICAL REQUIREMENTS**: aspect ratio, duration, resolution
- **ANTI-GOALS**: what must NOT appear

The use case also drives **context-aware defaults** (see `skills/_shared/veo-core/constants.ts`): audio defaults **off** for `hero-background` / `ambient` / `loop` and **on** for `social` / `marketing` / `product` / `storytelling`; an unspecified use case falls through to the library default (audio **on** for Veo 3.x). An explicit `--audio` / `--no-audio` always wins.

**If your request is vague**, Claude will ask clarifying questions first.

### Phase 2: CRAFT
Claude builds the prompt using the **5-Element Formula**:
```text
[Cinematography] + [Subject] + [Action] + [Context] + [Style & Ambiance]
```

### Phase 3: VALIDATE
Two layers of checks:

**Prompt-quality checks** (advisory in this release — softened to warnings): text/UI in frame, single-camera movement (rejected only for `loop`/`hero-background`, otherwise a warning), audio-on without an audio descriptor.

**Hard API-constraint check (new in 2.0.0)**: the resolved config is run through the library validator via `--dry-run` (`validateConfig()`). It catches model/duration/resolution conflicts, Veo 2 audio and resolution limits, sample-count and seed ranges, person-generation region rules, the Veo 3 "prompt enhancement always on" rule, and the `--output` / `--storage-uri` mutual exclusion. It **never throws** — it returns auto-fixes (e.g. duration bumped to 8 for 1080p/4k), warnings, or hard errors that must be fixed before presenting.

### Phase 4: PRESENT & AWAIT APPROVAL
Claude presents the resolved config with validation status and **waits for your approval** before generating. The block surfaces the resolved model, audio (with reason), person generation, negative prompt, any auto-adjustments, validation warnings, and a real cost estimate computed by `estimateCost()` via `--dry-run` — never hand-estimated:

```text
READY FOR REVIEW:

Prompt: [crafted prompt]
Settings:
  Model: veo-3.1-generate-001 (GA quality)
  Aspect: 16:9
  Duration: 8s
  Resolution: 1080p
  Audio: on (explicit --audio override; hero-background default is off)
  Person generation: allow_adult
  Negative prompt: "text, logos, watermarks"

Auto-adjustments applied:
  - Duration set to 8s (required by 1080p)

Validation: PASSED (1 warning)
  ⚠ Audio is on but prompt has no Audio Layer descriptors

Cost estimate: ~$X.XX (from --dry-run / estimateCost())
Generation time: 2-4 minutes

Shall I generate this video?
```

### Phase 5: GENERATE
Only after approval, generation begins.

### Phase 6: ITERATE
If results don't match expectations, Claude guides targeted improvements rather than starting over.

## Quick Start

### Prerequisites

1. [Google Cloud account](https://cloud.google.com/) with billing enabled
2. **Node.js + npm** — required to install the `@veo-core` runtime dependencies (`npm install` at the repo root)
3. Claude Code installed
4. *(Optional)* [gcloud CLI](https://cloud.google.com/sdk/docs/install) — no longer required for authentication (auth now goes through `google-auth-library`), but convenient for the manual GCP setup steps below

### Automated Setup (Recommended)

Use the `veo-setup` skill to configure everything:

```text
Set up Google Cloud for Veo video generation
```

Claude will walk you through:
- Creating or selecting a GCP project
- Enabling Vertex AI API
- Creating service account with correct permissions
- Generating credentials file
- Configuring environment variables
- Verifying the complete setup

### Generate Videos

Once configured, use the `veo` skill:

```text
Generate a hero background video for a tech startup landing page
```

```text
Create a looping ambient video of abstract particles for my SaaS website
```

```text
Make a 4-second seamless loop of morning mist over a lake
```

For longer narrative content, use the `veo-multi-shot` skill:

```text
Create a 30-second product launch video for our new app
```

### Create Seamless Loops

Use the `video-loop` skill to convert any video into a seamless infinite loop:

```text
Create a seamless loop from hero-background.mp4
```

---

## Manual Setup

If you prefer to configure manually, follow these steps:

### Step 1: Create or Select a Google Cloud Project

**New project:**
```bash
gcloud projects create YOUR_PROJECT_ID --name="Veo Video Generation"
gcloud config set project YOUR_PROJECT_ID
```

**Existing project:**
```bash
gcloud config set project YOUR_PROJECT_ID
```

### Step 2: Enable Vertex AI API

```bash
gcloud services enable aiplatform.googleapis.com
```

### Step 3: Create Service Account

```bash
# Create service account
gcloud iam service-accounts create veo-generator \
  --display-name="Veo Video Generator"

# Grant Vertex AI User role
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:veo-generator@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

# Create and download key file
gcloud iam service-accounts keys create ~/veo-service-account.json \
  --iam-account=veo-generator@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

### Step 4: Set Environment Variables

Add to your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
# Project (GOOGLE_CLOUD_PROJECT_ID is also accepted as a fallback)
export GOOGLE_CLOUD_PROJECT="YOUR_PROJECT_ID"

# Authentication — service-account key file (one supported option; see Step 5)
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/veo-service-account.json"

# Optional (defaults to us-central1)
export GOOGLE_CLOUD_LOCATION="us-central1"
```

Reload your shell:

```bash
source ~/.zshrc  # or source ~/.bashrc
```

### Step 5: Authentication

Authentication goes through `google-auth-library`, which supports multiple credential sources — no `gcloud auth application-default login` is required when a service-account key is set:

- **Service account key** — set `GOOGLE_APPLICATION_CREDENTIALS` to the JSON key path (Step 4). The library reads it directly.
- **Application Default Credentials (ADC)** — e.g. `gcloud auth application-default login` for local development.
- **Workload Identity** — automatic on GKE / Cloud Run and other GCP runtimes.

### Step 6: Verify Setup

```bash
# Check environment variables
echo $GOOGLE_CLOUD_PROJECT
echo $GOOGLE_APPLICATION_CREDENTIALS

# Verify the credentials file exists (only when using a service-account key;
# skip if you rely on ADC or Workload Identity, where this var is unset)
[ -n "$GOOGLE_APPLICATION_CREDENTIALS" ] && ls -la "$GOOGLE_APPLICATION_CREDENTIALS"

# Run a no-cost validation + cost preview (does not call the generation API)
npx ts-node skills/veo/scripts/veo-generate.ts --prompt "test" --output ./test.mp4 --dry-run
```

---

## Direct Script Usage

For programmatic use without Claude. Run from the **repo root** after `npm install`:

```bash
npx ts-node skills/veo/scripts/veo-generate.ts \
  --prompt "Slow dolly through floating data particles, seamless loop, locked camera, ethereal blue palette" \
  --duration 4 \
  --resolution 720p \
  --output ./hero-background.mp4
```

The script is a thin entry point that requires `bootstrap.ts` (to register `@veo-core/*`) before importing the library, so it needs the root dependencies installed and the `.claude-plugin/plugin.json` root marker present. Add `--dry-run` to validate the config and print a cost estimate without calling the API.

### Script Options

| Option | Values | Default | Notes |
|--------|--------|---------|-------|
| `--prompt` | string | required | Cinematic prompt |
| `--output` | path | — | Local output file. Mutually exclusive with `--storage-uri` |
| `--storage-uri` | `gs://...` | — | Server-side delivery to a GCS bucket. Mutually exclusive with `--output` |
| `--model` | see Models | `veo-3.1-generate-001` | Model variant |
| `--aspect-ratio` | `16:9`, `9:16` | `16:9` | Video aspect ratio |
| `--duration` | Veo 3.x: `4`/`6`/`8`; Veo 2: `5`/`6`/`8` | `8` | Seconds. `1080p`/`4k` force duration `8` |
| `--resolution` | `720p`, `1080p`, `4k` | `720p` | Veo 2 caps at `720p`; Veo 3.1 Lite caps at `1080p` |
| `--audio` | flag | model-based | Force audio **on** (overrides the default) |
| `--no-audio` | flag | model-based | Force audio **off** (overrides the default) |
| `--sample-count` | `1`–`MODEL_SAMPLE_MAX` | `1` | Max 4 (Veo 3.x) / 2 (Veo 2). Bills N videos; only the first is retrieved |
| `--seed` | integer `0`–`2147483647` | random | Best-effort determinism on Veo 3 |
| `--negative-prompt` | string | — | Exclude content matching this phrase (list of unwanted elements) |
| `--enhance-prompt` | flag | on | Server-side prompt enhancement on |
| `--no-enhance-prompt` | flag | — | Disable enhancement (Veo 2 only — Veo 3 rejects disabling) |
| `--person-generation` | `allow_all`, `allow_adult`, `disallow` | — | Region-restricted (`allow_all` downgrades to `allow_adult` in EU/UK/CH/MENA) |
| `--add-watermark` | flag | on | Add SynthID watermark |
| `--no-add-watermark` | flag | — | Disable SynthID watermark |
| `--include-rai-reason` | flag | — | Include Responsible-AI block reason in error responses |
| `--dry-run` | flag | — | Validate + estimate cost only; do not call the API |

> **Audio default (a 2.0.0 breaking change).** At the CLI/library level the `generateAudio` default is **model-based**: on for Veo 3.x, off for Veo 2 (set by `validateConfig` when neither flag is passed). The `/veo` skill adds a use-case layer on top in its Phase 1 workflow — off for `hero-background`/`ambient`/`loop`, on for `social`/`marketing`/`product`/`storytelling` — by choosing which flag to pass; the CLI itself does not infer the use case. Use `--audio` / `--no-audio` to force it.

**Models** (`AVAILABLE_MODELS`):

- `veo-3.1-generate-001` — GA, higher quality (**default**)
- `veo-3.1-fast-generate-001` — GA, faster generation
- `veo-3.1-lite-generate-001` — preview; caps at 1080p
- `veo-3.0-generate-001` — **deprecated** (discontinuation 30 Jun 2026)
- `veo-3.0-fast-generate-001` — **deprecated** (discontinuation 30 Jun 2026)
- `veo-2.0-generate-001` — **deprecated**; no audio, caps at 720p

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GOOGLE_CLOUD_PROJECT` | Yes* | - | GCP project ID. `GOOGLE_CLOUD_PROJECT_ID` is accepted as a fallback |
| `GOOGLE_APPLICATION_CREDENTIALS` | No** | - | Path to service-account JSON. One of several auth sources |
| `GOOGLE_CLOUD_LOCATION` | No | us-central1 | GCP region for Vertex AI |

\* Either `GOOGLE_CLOUD_PROJECT` or `GOOGLE_CLOUD_PROJECT_ID` must be set.

\*\* `google-auth-library` resolves credentials from `GOOGLE_APPLICATION_CREDENTIALS`, ADC, or Workload Identity. The env var is one option, not unconditionally required — but at least one credential source must be available.

---

## Development

The repo ships a test and typecheck toolchain:

```bash
npm test          # vitest run
npm run typecheck # tsc --noEmit
```

CI (`.github/workflows/test.yml`) runs `npm ci`, the typecheck, and the test suite on pull requests and pushes to `main`. Tests resolve `@veo-core` via an alias in `vitest.config.ts`.

---

## Troubleshooting

### "Permission denied" errors

Ensure the service account has the correct role:

```bash
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:veo-generator@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

### "API not enabled" errors

```bash
gcloud services enable aiplatform.googleapis.com
```

### "no access token" / credentials errors

The error `google-auth-library returned no access token. Check GOOGLE_APPLICATION_CREDENTIALS / ADC.` means no usable credential source was found. Confirm one of the following:

- `GOOGLE_APPLICATION_CREDENTIALS` points at a valid service-account key file, or
- ADC is configured (`gcloud auth application-default login`), or
- Workload Identity is available in your runtime.

### `bootstrap.ts: could not locate repo root`

A script was run outside a checkout that contains `.claude-plugin/plugin.json` at its root, or only `skills/*` was copied. Run from the full repo checkout after `npm install` (see [Manual Copy](#option-2-manual-copy)).

### Generation times out

The poll timeout is a fixed **10 minutes** and is not user-configurable. Transient failures (high load, 5xx, network resets) are retried up to 5 consecutive times; permanent errors (auth, RAI, invalid operation) fail fast. If you hit the timeout:
- Check your network connection
- Try the fast model: `--model veo-3.1-fast-generate-001`

---

## Breaking changes in 2.0.0

- **`generateVideo(config)` signature** — the library now takes a single config object. See [`docs/releases/2.0.0.md`](docs/releases/2.0.0.md) and [`CHANGELOG.md`](CHANGELOG.md).
- **Context-aware audio default** — audio defaults are now derived from the model and use case (previously always off). Use `--audio` / `--no-audio` to override.
- **gcloud no longer required for auth** — authentication moved to `google-auth-library` (ADC / service account / Workload Identity).

Full migration guide: [`docs/releases/2.0.0.md`](docs/releases/2.0.0.md).

---

## Repository Structure

```text
veo-tools/
├── .claude-plugin/
│   ├── marketplace.json          # Plugin marketplace metadata
│   └── plugin.json               # Plugin configuration (repo-root marker)
├── .github/
│   └── workflows/
│       └── test.yml              # CI: npm ci + typecheck + test
├── docs/
│   └── releases/
│       └── 2.0.0.md              # Foundation release notes / migration guide
├── skills/
│   ├── _shared/
│   │   └── veo-core/             # Shared @veo-core library
│   │       ├── api.ts            # Vertex AI submit / poll / download
│   │       ├── auth.ts           # google-auth-library token issuance
│   │       ├── bootstrap.ts      # tsconfig-paths registration
│   │       ├── constants.ts      # Frozen Veo lookup tables
│   │       ├── generate.ts       # auth → validate → submit → poll orchestration
│   │       ├── image-helpers.ts  # Image input handling
│   │       ├── pricing.ts        # estimateCost()
│   │       ├── types.ts          # VeoConfig + result types
│   │       ├── validation.ts     # validateConfig() rules
│   │       └── __tests__/        # vitest suites
│   ├── veo/                      # Single-shot generation skill
│   │   ├── SKILL.md              # 6-phase workflow + prompt engineering
│   │   ├── scripts/
│   │   │   ├── veo-generate.ts   # CLI entry point
│   │   │   └── cli-utils.ts      # Flag parsing + buildConfig
│   │   ├── validation/
│   │   │   └── prompt-checklist.md
│   │   ├── references/
│   │   │   ├── cinematography-lexicon.md
│   │   │   └── audio-lexicon.md
│   │   └── examples/
│   │       ├── hero-prompts.md
│   │       └── audio-on.md
│   ├── veo-multi-shot/           # Multi-clip narrative skill
│   │   ├── SKILL.md
│   │   ├── scripts/
│   │   │   ├── veo-multi-generate.ts
│   │   │   ├── multi-cli-utils.ts
│   │   │   └── assemble-clips.sh
│   │   ├── templates/            # Shot lists + Visual DNA presets
│   │   ├── validation/
│   │   └── examples/
│   ├── veo-setup/                # Setup skill
│   │   └── SKILL.md
│   └── video-loop/               # Loop creation skill
│       ├── SKILL.md
│       └── scripts/
│           └── create-loop.sh
├── package.json                  # npm project: runtime + dev deps, scripts
├── tsconfig.json                 # @veo-core/* path mapping
├── vitest.config.ts              # Test config + @veo-core alias
├── CHANGELOG.md
├── RELEASE_NOTES.md
├── CONTRIBUTING.md
├── README.md
└── LICENSE
```

---

## License

MIT
