// multi-cli-utils.ts — pure storyboard helpers for veo-multi-generate.
if (!process.env.VITEST) require('../../_shared/veo-core/bootstrap')

import * as fs from 'node:fs'
import { estimateCost } from '@veo-core/pricing'
import { validateConfig } from '@veo-core/validation'
import type { VeoConfig } from '@veo-core/types'

export type Storyboard = { shots: VeoConfig[] }

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
