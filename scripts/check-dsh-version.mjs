#!/usr/bin/env node
/**
 * check-dsh-version.mjs — watch the DSH release cadence without watching the repo.
 *
 * DSH publishes every @deepseek-ai/dsh-* package at the same version, so the
 * npm "latest" of @deepseek-ai/dsh is the single authoritative release signal.
 *
 * npm's prerelease matching rule only accepts a prerelease candidate when the
 * range contains a comparator on the SAME [major, minor, patch] tuple, so the
 * peer range carries one `^<tuple>-0` term per supported DSH patch tuple:
 *   "^0.1.0-rc.6 || ^0.1.1-0 || ^0.1.2-0 || ^0.1.3-0 || ^0.1.5-0"
 * `-0` is a tuple's lowest prerelease, so same-tuple rolls (rc.2 → rc.3, or an
 * alpha series) keep working and need no action — while a NEW tuple silently
 * stops matching until its own `^<tuple>-0` term is appended.
 *
 * This script compares the current DSH tuple against the tuples covered by the
 * first @deepseek-ai/dsh-* peer range in package.json and exits:
 *   0 — current DSH tuple is covered, no action needed.
 *   1 — DSH moved to a new tuple; append an OR term and re-verify.
 *   2 — registry unreachable or unparseable (never blocks a release silently
 *       as "OK"; the caller decides whether to treat it as a warning).
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))

function dshPeers(manifest) {
  return Object.keys(manifest.peerDependencies ?? {})
    .filter((name) => name.startsWith('@deepseek-ai/dsh-'))
}

function coveredTuples(range) {
  const tuples = new Set()
  for (const match of range.matchAll(/(\d+)\.(\d+)\.(\d+)/g)) {
    tuples.add(`${match[1]}.${match[2]}.${match[3]}`)
  }
  return tuples
}

const peers = dshPeers(MANIFEST)
if (peers.length === 0) {
  console.log('check-dsh-version: no @deepseek-ai/dsh-* peer declared — nothing to track')
  process.exit(0)
}

const probe = MANIFEST.peerDependencies[peers[0]]
const covered = coveredTuples(probe)

let latest
try {
  const response = await fetch('https://registry.npmjs.org/@deepseek-ai/dsh/latest')
  if (!response.ok) throw new Error(`registry responded ${response.status}`)
  latest = (await response.json()).version
} catch (error) {
  console.error(`check-dsh-version: cannot reach npm registry (${error.message})`)
  process.exit(2)
}

const tuple = /^(\d+\.\d+\.\d+)/.exec(latest)?.[1] ?? null
if (tuple === null) {
  console.error(`check-dsh-version: unparseable latest DSH version "${latest}"`)
  process.exit(2)
}

const coveredList = [...covered].sort().join(', ')
console.log(`DSH latest:      ${latest}`)
console.log(`probe peer:      ${peers[0]} = "${probe}"`)
console.log(`covered tuples:  ${coveredList}`)

if (covered.has(tuple)) {
  console.log('OK: current DSH tuple is covered — no peer change needed (same-tuple rc rolls are unaffected).')
  process.exit(0)
}

console.log('ACTION NEEDED: DSH moved to a new version tuple.')
console.log(`  1. Append "|| ^${tuple}-0" to the @deepseek-ai/dsh-* peer range in package.json`)
console.log('     ("-0" is that tuple\'s lowest prerelease, so later rc/alpha rolls of the same')
console.log('     tuple need no edit; once DSH ships a final release the union can converge to a')
console.log('     single stable range).')
console.log('  2. Re-verify the compile-time types against the new DSH: on 0.1.5+ ClientContext is')
console.log('     the cordis Context and SessionFace lives in @deepseek-ai/dsh-api-session-controller/client.')
console.log('  3. npm install, rerun typecheck / tests / scripts/verify-host.mjs, then release.')
process.exit(1)
