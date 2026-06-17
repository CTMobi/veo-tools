// multi-cli-utils.ts — pure storyboard helpers for veo-multi-generate.
if (!process.env.VITEST) require('../../_shared/veo-core/bootstrap')

import * as fs from 'node:fs'
import { estimateCost } from '@veo-core/pricing'
import { validateConfig } from '@veo-core/validation'
import type { VeoConfig } from '@veo-core/types'

export type Storyboard = { shots: VeoConfig[] }

export type MultiArgs = { storyboardPath: string; dryRun: boolean; help: boolean }

// parseArgs — pure flag plumbing for veo-multi-generate. Like veo's cli-utils
// parseArgs, a value-taking flag peeks the next token instead of blindly
// consuming it, so `--storyboard --dry-run` does not eat --dry-run as the path.
// Unknown flags are rejected rather than silently ignored.
export function parseArgs(argv: string[]): MultiArgs {
  const out: MultiArgs = { storyboardPath: '', dryRun: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--storyboard') {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        console.error(`Flag ${a} requires a value`)
        process.exit(2)
      }
      i += 1
      out.storyboardPath = next
    } else if (a === '--dry-run') {
      out.dryRun = true
    } else if (a === '--help') {
      out.help = true
    } else {
      console.error(`Unknown flag: ${a}`)
      process.exit(2)
    }
  }
  return out
}

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
