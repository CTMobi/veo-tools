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
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    // Surface a clear, contextual error instead of a raw SyntaxError stack so a
    // malformed storyboard file is diagnosable (which file, what went wrong).
    throw new Error(`invalid storyboard JSON at ${p}: ${(e as Error).message}`)
  }
  if (!parsed || !Array.isArray((parsed as { shots?: unknown }).shots)) {
    throw new Error(`storyboard missing "shots" array: ${p}`)
  }
  return parsed as Storyboard
}

// validateShots — validate every shot, exiting 2 on the first invalid shot (before
// any paid call). Returns the resolved (auto-fixed) configs. This runs on EVERY run,
// live or dry; cost printing is separated out into runDryRun.
export function validateShots(sb: Storyboard): VeoConfig[] {
  const resolved: VeoConfig[] = []
  for (const [i, shot] of sb.shots.entries()) {
    const v = validateConfig(shot)
    if (!v.valid) {
      console.error(`shot ${i}: invalid — ${v.errors.join('; ')}`)
      process.exit(2)
    }
    resolved.push(v.autoFixed)
  }
  return resolved
}

// runDryRun — print cost estimates only. Should only be called under --dry-run; a
// live run validates (validateShots) but must NOT print cost lines to stdout, which
// would pollute the JSON output. estimateCost throws on an unknown model/resolution
// (validateConfig only warns there), so catch per-shot and exit 2 as a config error.
export function runDryRun(sb: Storyboard): void {
  let totalCost = 0
  for (const [i, shot] of sb.shots.entries()) {
    const v = validateConfig(shot)
    if (!v.valid) {
      console.error(`shot ${i}: invalid — ${v.errors.join('; ')}`)
      process.exit(2)
    }
    let cost: ReturnType<typeof estimateCost>
    try {
      cost = estimateCost(v.autoFixed)
    } catch (e) {
      console.error(`shot ${i}: ${e instanceof Error ? e.message : String(e)}`)
      process.exit(2)
    }
    totalCost += cost.usd
    console.log(`shot ${i}: ${cost.breakdown} — $${cost.usd.toFixed(2)}`)
  }
  console.log(`total estimated cost: $${totalCost.toFixed(2)}`)
}
