#!/usr/bin/env ts-node
// veo-generate — thin CLI entry. All semantics live in @veo-core/*.
require('../../_shared/veo-core/bootstrap')

import { generateVideo } from '@veo-core/generate'
import { estimateCost } from '@veo-core/pricing'
import { validateConfig } from '@veo-core/validation'
import { parseArgs, buildConfig, printHelp } from './cli-utils'

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const flags = parseArgs(argv)
  if (flags['--help']) {
    printHelp()
    return
  }
  if (!flags['--prompt']) {
    console.error('--prompt is required')
    process.exit(2)
  }
  const cfg = buildConfig(flags)
  if (flags['--dry-run']) {
    const v = validateConfig(cfg)
    if (!v.valid) {
      console.error('Invalid:', v.errors.join('; '))
      process.exit(2)
    }
    // estimateCost throws on an unknown model/resolution (validateConfig only warns
    // there). Treat that as a config error (exit 2), not a crash (exit 1 via top-level
    // catch), to stay consistent with the other CLI validation failures above.
    let cost: ReturnType<typeof estimateCost>
    try {
      cost = estimateCost(v.autoFixed)
    } catch (e) {
      console.error('Invalid:', e instanceof Error ? e.message : String(e))
      process.exit(2)
    }
    console.log('PRESENT')
    console.log(`  model:           ${v.autoFixed.model}`)
    console.log(`  resolution:      ${v.autoFixed.resolution}`)
    console.log(`  duration:        ${v.autoFixed.durationSeconds}s`)
    console.log(`  audio:           ${v.autoFixed.generateAudio}`)
    if (v.autoFixMessages.length) console.log(`  auto-adjustments:\n    - ${v.autoFixMessages.join('\n    - ')}`)
    if (v.warnings.length)        console.log(`  warnings:\n    - ${v.warnings.join('\n    - ')}`)
    console.log(`  estimated cost:  $${cost.usd.toFixed(2)} (${cost.breakdown})`)
    return
  }
  const result = await generateVideo(cfg)
  console.log(JSON.stringify(result, null, 2))
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
