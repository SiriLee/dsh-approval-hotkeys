#!/usr/bin/env node
/**
 * check-dsh-version.mjs — watch the DSH release cadence without watching the repo.
 *
 * DSH publishes every @deepseek-ai/dsh-* package at the same version, so the
 * registry's dist-tags are the authoritative release signal. DSH keeps
 * pre-releases on their own tags: `latest` trails at the last promoted release
 * while `next`/`alpha` carry the line under development. Probing `latest` alone
 * therefore misses exactly the releases this plugin has to adapt to — 0.1.7-rc.1
 * shipped under `next` while `latest` still said 0.1.5-rc.3, which is why the
 * 0.1.7 tuple went unnoticed. This script compares the HIGHEST tuple published
 * under ANY dist-tag against the tuples the peer range covers.
 *
 * Peer-range rule: npm's prerelease matching only accepts a prerelease
 * candidate when the range carries a comparator on the SAME [major, minor,
 * patch] tuple, so the range carries one `^<tuple>-0` term per supported tuple:
 *   "^0.1.7-rc.1"
 * `-0` is a tuple's lowest prerelease, so same-tuple rolls (rc.2 → rc.3, or an
 * alpha series) need no edit — while a NEW tuple stops matching until its own
 * `^<tuple>-0` term is appended. Note that a *floor* term (`^0.1.7-rc.1`) also
 * refuses anything below it, which is deliberate: this plugin targets one DSH
 * line, and older lines are served by the release frozen on them.
 *
 * Exit:
 *   0 — every published tuple is covered (or merely behind the covered floor).
 *   1 — a tuple ahead of the covered range is published; append its term.
 *   2 — registry unreachable or unparseable (never reported as "OK").
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))
const PROBE_URL = 'https://registry.npmjs.org/@deepseek-ai/dsh'

const tupleOf = (version) => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  return match === null ? null : `${match[1]}.${match[2]}.${match[3]}`
}
/** Numeric triple comparison (tuples carry no prerelease part). */
const compareTuples = (left, right) => {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return 0
}

const peers = Object.keys(MANIFEST.peerDependencies ?? {}).filter((name) => name.startsWith('@deepseek-ai/dsh'))
if (peers.length === 0) {
  console.log('check-dsh-version: no @deepseek-ai/dsh-* peer declared — nothing to track')
  process.exit(0)
}

const probe = MANIFEST.peerDependencies[peers[0]]
const covered = new Set()
for (const match of probe.matchAll(/(\d+)\.(\d+)\.(\d+)/g)) covered.add(`${match[1]}.${match[2]}.${match[3]}`)
const floor = [...covered].sort(compareTuples).at(-1)

let tags
try {
  const response = await fetch(PROBE_URL)
  if (!response.ok) throw new Error(`registry responded ${response.status}`)
  // The registry spells the field `dist-tags`.
  tags = (await response.json())['dist-tags']
} catch (error) {
  console.error(`check-dsh-version: cannot reach npm registry (${error.message})`)
  process.exit(2)
}
if (typeof tags !== 'object' || tags === null || Object.keys(tags).length === 0) {
  console.error(`check-dsh-version: no dist-tags in the registry document for ${PROBE_URL}`)
  process.exit(2)
}

const published = new Map()
for (const [tag, version] of Object.entries(tags)) {
  const tuple = typeof version === 'string' ? tupleOf(version) : null
  if (tuple === null) {
    console.error(`check-dsh-version: unparseable version "${String(version)}" on tag "${tag}"`)
    process.exit(2)
  }
  published.set(tag, { version, tuple })
}

console.log(`probe peer:   ${peers[0]} = "${probe}"`)
console.log(`covered:      ${[...covered].sort(compareTuples).join(', ')} (floor ${floor})`)
for (const [tag, { version, tuple }] of [...published].sort((a, b) => compareTuples(a[1].tuple, b[1].tuple))) {
  console.log(`dist-tag:     ${tag.padEnd(8)} ${version}${tuple > floor ? '  <-- ahead of the covered range' : ''}`)
}

const ahead = [...published].filter(([, { tuple }]) => compareTuples(tuple, floor) > 0)
if (ahead.length === 0) {
  console.log('OK: no published dist-tag is ahead of the covered DSH tuples.')
  process.exit(0)
}

const [tag, { version, tuple }] = ahead.sort((a, b) => compareTuples(a[1].tuple, b[1].tuple)).at(-1)
console.log(`ACTION NEEDED: DSH ${version} (tag "${tag}") is on a tuple the peer range does not cover.`)
console.log(`  1. Verify the plugin against that DSH line (a local monorepo checkout of the tag is the`)
console.log('     reference: docs/subsystems/ + packages/client/*/src).')
console.log(`  2. Point every @deepseek-ai/dsh-* peer AND devDependency at the verified tuple:`)
console.log(`       peer:  "^${tuple}-rc.1" (or "^${tuple}-0" for the whole tuple, prereleases included)`)
console.log(`       dsh.engines.dsh: ">=${tuple}-rc.1"`)
console.log('     Note the floor term refuses older lines by design — releases frozen on them keep serving them.')
console.log('  3. npm install → npm run check → release.')
process.exit(1)
