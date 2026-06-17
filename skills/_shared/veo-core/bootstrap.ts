// bootstrap.ts — registers tsconfig-paths programmatically.
// Entry scripts MUST require() this before any @veo-core/* import.
import * as fs from 'node:fs'
import * as path from 'node:path'
import { register } from 'tsconfig-paths'

function findRepoRoot(start: string): string {
  let dir = start
  // Walk upward looking for the .claude-plugin/plugin.json marker.
  // Guards against landing in /tmp or in node_modules during weird invocations.
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, '.claude-plugin', 'plugin.json'))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(
    `bootstrap.ts: could not locate repo root (no .claude-plugin/plugin.json found above ${start})`
  )
}

const REPO_ROOT = findRepoRoot(__dirname)

register({
  baseUrl: REPO_ROOT,
  paths: {
    '@veo-core/*': ['skills/_shared/veo-core/*'],
  },
})

export { REPO_ROOT }
