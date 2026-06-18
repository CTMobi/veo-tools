#!/usr/bin/env ts-node
// veo-multi-generate — thin CLI: load a storyboard JSON, validate each shot,
// optionally execute sequentially. All semantics in @veo-core/*.
require('../../_shared/veo-core/bootstrap')

import { generateVideo } from '@veo-core/generate'
import { loadStoryboard, runDryRun, validateShots, parseArgs } from './multi-cli-utils'

async function main(): Promise<void> {
  const { storyboardPath, dryRun, help } = parseArgs(process.argv.slice(2))
  if (help) {
    console.log('--storyboard PATH  storyboard JSON with {shots: VeoConfig[]}')
    console.log('--dry-run           validate + cost only')
    return
  }
  if (!storyboardPath) { console.error('--storyboard required'); process.exit(2) }
  const sb = loadStoryboard(storyboardPath)

  // Always validate every shot (exits 2 on first invalid shot — no paid call yet).
  // Cost estimates are printed ONLY under --dry-run; a live run must keep stdout
  // clean for the per-shot JSON results below.
  if (dryRun) {
    runDryRun(sb)
    return
  }
  // Capture the resolved (auto-fixed) configs and generate from those, rather than
  // re-iterating the raw sb.shots (which would discard validateShots's resolution).
  const resolvedShots = validateShots(sb)

  for (const [i, shot] of resolvedShots.entries()) {
    // Progress text goes to STDERR so stdout carries only the per-shot JSON results
    // (consistent with the round-2 stdout-cleanliness fix).
    console.error(`generating shot ${i}...`)
    const r = await generateVideo(shot)
    console.log(JSON.stringify(r, null, 2))
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1) })
