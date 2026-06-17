#!/usr/bin/env ts-node
// veo-multi-generate — thin CLI: load a storyboard JSON, validate each shot,
// optionally execute sequentially. All semantics in @veo-core/*.
require('../../_shared/veo-core/bootstrap')

import { generateVideo } from '@veo-core/generate'
import { loadStoryboard, runDryRun } from './multi-cli-utils'

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  let storyboardPath = ''
  let dryRun = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--storyboard') storyboardPath = argv[++i] ?? ''
    else if (argv[i] === '--dry-run') dryRun = true
    else if (argv[i] === '--help') {
      console.log('--storyboard PATH  storyboard JSON with {shots: VeoConfig[]}')
      console.log('--dry-run           validate + cost only')
      return
    }
  }
  if (!storyboardPath) { console.error('--storyboard required'); process.exit(2) }
  const sb = loadStoryboard(storyboardPath)

  // Validate + cost every shot (exits 2 on first invalid shot — no paid call yet)
  runDryRun(sb)
  if (dryRun) return

  for (const [i, shot] of sb.shots.entries()) {
    console.log(`generating shot ${i}...`)
    const r = await generateVideo(shot)
    console.log(JSON.stringify(r, null, 2))
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1) })
