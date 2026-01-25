# Veo - AI Video Generation Skills for Claude Code

Generate cinematic video content using Google Veo 3.1 via Vertex AI. Optimized for website hero backgrounds, marketing materials, and ambient looping visuals.

## Installation

### Option 1: Plugin Marketplace (Recommended)

```bash
/plugin marketplace add kdowswell/veo-tools
/plugin install veo-tools
```

### Option 2: Manual Copy

```bash
# Clone the repository
git clone https://github.com/kdowswell/veo-tools.git

# Copy skills to Claude Code (global)
cp -r veo-tools/skills/* ~/.claude/skills/

# Or project-specific
cp -r veo-tools/skills/* /path/to/your/project/.claude/skills/
```

## Skills Included

| Skill | Command | Description |
|-------|---------|-------------|
| `veo` | `/veo` | Generate AI videos with cinematic prompt engineering |
| `veo-setup` | `/veo-setup` | Configure Google Cloud project and authentication |
| `video-loop` | `/video-loop` | Create seamless infinite loops from any video |

## How the Veo Skill Works

The `/veo` skill follows a **6-phase workflow** designed to prevent bad prompts from reaching expensive API calls:

```
User Request → UNDERSTAND → CRAFT → VALIDATE → PRESENT → GENERATE → ITERATE
```

### Phase 1: UNDERSTAND
Claude gathers context before crafting any prompt:
- Use case (hero background, marketing, social, product)
- Mood and visual direction
- Technical requirements
- What must NOT appear

**If your request is vague**, Claude will ask clarifying questions first.

### Phase 2: CRAFT
Claude builds the prompt using the **5-Element Formula**:
```
[Cinematography] + [Subject] + [Action] + [Context] + [Style & Ambiance]
```

### Phase 3: VALIDATE
Every prompt is checked against quality criteria:
- Single camera movement (no stacking)
- No text/UI requests (Veo can't render text)
- No conflicting descriptors
- Loop flags present (for hero backgrounds)
- Material specificity included

### Phase 4: PRESENT & AWAIT APPROVAL
Claude presents the prompt with validation status and **waits for your approval** before generating:

```
READY FOR REVIEW:

Prompt: [crafted prompt]
Settings: 16:9, 4s, 720p
Validation: PASSED

Shall I generate this video? (Cost: ~$0.50, Time: 2-4 minutes)
```

### Phase 5: GENERATE
Only after approval, generation begins.

### Phase 6: ITERATE
If results don't match expectations, Claude guides targeted improvements rather than starting over.

## Quick Start

### Prerequisites

1. [Google Cloud account](https://cloud.google.com/) with billing enabled
2. [gcloud CLI](https://cloud.google.com/sdk/docs/install) installed
3. Claude Code installed

### Automated Setup (Recommended)

Use the `veo-setup` skill to configure everything:

```
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

```
Generate a hero background video for a tech startup landing page
```

```
Create a looping ambient video of abstract particles for my SaaS website
```

```
Make a 4-second seamless loop of morning mist over a lake
```

### Create Seamless Loops

Use the `video-loop` skill to convert any video into a seamless infinite loop:

```
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
# Required
export GOOGLE_CLOUD_PROJECT="YOUR_PROJECT_ID"
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/veo-service-account.json"

# Optional (defaults to us-central1)
export GOOGLE_CLOUD_LOCATION="us-central1"
```

Reload your shell:

```bash
source ~/.zshrc  # or source ~/.bashrc
```

### Step 5: Authenticate gcloud

```bash
gcloud auth application-default login
```

### Step 6: Verify Setup

```bash
# Check environment variables
echo $GOOGLE_CLOUD_PROJECT
echo $GOOGLE_APPLICATION_CREDENTIALS

# Verify credentials file exists
ls -la $GOOGLE_APPLICATION_CREDENTIALS

# Test authentication
gcloud auth application-default print-access-token
```

---

## Direct Script Usage

For programmatic use without Claude:

```bash
cd skills/veo/scripts

npx ts-node veo-generate.ts \
  --prompt "Slow dolly through floating data particles, seamless loop, locked camera, ethereal blue palette" \
  --duration 4 \
  --resolution 720p \
  --output ./hero-background.mp4
```

### Script Options

| Option | Values | Default | Description |
|--------|--------|---------|-------------|
| `--prompt`, `-p` | string | required | Cinematic prompt |
| `--output`, `-o` | path | ./veo-output.mp4 | Output file path |
| `--aspect-ratio` | 16:9, 9:16 | 16:9 | Video aspect ratio |
| `--duration` | 4, 6, 8 | 8 | Duration in seconds (API limit) |
| `--resolution` | 720p, 1080p | 720p | Video resolution |
| `--audio` | flag | false | Enable audio generation |
| `--model` | see below | quality | Model variant |
| `--seed` | integer | random | For reproducibility |
| `--samples` | 1-4 | 1 | Number of variations |

**Models:**
- `veo-3.1-generate-001` - Higher quality (default)
- `veo-3.1-fast-generate-001` - Faster generation

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GOOGLE_CLOUD_PROJECT` | Yes | - | Your GCP project ID |
| `GOOGLE_APPLICATION_CREDENTIALS` | Yes | - | Path to service account JSON |
| `GOOGLE_CLOUD_LOCATION` | No | us-central1 | GCP region for Vertex AI |

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

### "Could not find default credentials" errors

```bash
gcloud auth application-default login
```

### Service account file not found

```bash
ls -la $GOOGLE_APPLICATION_CREDENTIALS
```

### Generation times out

Veo generation typically takes 2-4 minutes. If timing out:
- Check your network connection
- Try the fast model: `--model veo-3.1-fast-generate-001`
- Reduce duration: `--duration 4`

---

## Repository Structure

```
veo-tools/
├── .claude-plugin/
│   ├── marketplace.json          # Plugin marketplace metadata
│   └── plugin.json               # Plugin configuration
├── skills/
│   ├── veo/                      # Video generation skill
│   │   ├── SKILL.md              # 6-phase workflow + prompt engineering
│   │   ├── scripts/
│   │   │   └── veo-generate.ts   # Generation script
│   │   ├── validation/
│   │   │   └── prompt-checklist.md  # Quality validation rules
│   │   ├── references/
│   │   │   └── cinematography-lexicon.md
│   │   └── examples/
│   │       └── hero-prompts.md   # Annotated example prompts
│   ├── veo-setup/                # Setup skill
│   │   └── SKILL.md              # GCP configuration guide
│   └── video-loop/               # Loop creation skill
│       ├── SKILL.md              # Usage instructions
│       └── scripts/
│           └── create-loop.sh    # FFmpeg loop script
├── README.md
└── LICENSE
```

---

## License

MIT
