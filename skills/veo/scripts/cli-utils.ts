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
