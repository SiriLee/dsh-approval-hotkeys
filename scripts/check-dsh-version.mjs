#!/usr/bin/env node
/**
 * check-dsh-version.mjs — is a published DSH release outside the declared window?
 *
 * DSH publishes every @deepseek-ai/dsh-* package at one version but spreads the
 * releases across dist-tags: 0.1.7-rc.1 shipped under `next` while `latest` said
 * 0.1.5-rc.3, and 0.2.1-alpha.5 sits under `alpha` while `latest` says
 * 0.2.0-rc.2. Reading every tag is the only way not to miss a line, and missing
 * one is exactly how the 0.1.7 adaptation went unnoticed.
 *
 * Since DSH 0.2.x, `dsh.engines.dsh` decides plugin admission ALONE — the
 * harness ignores peer ranges when it is present — so that range is the probe.
 * It carries both ends: a floor that refuses older lines (releases frozen on
 * them keep serving them) and a ceiling that refuses the next tuple instead of
 * admitting it the day it is published, unchecked.
 *
 * Exit:
 *   0 — every published dist-tag is inside the declared window.
 *   1 — one is outside it: verify that line, then move the window and the pins.
 *   2 — registry unreachable, or the declared window is unusable.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))
const PROBE_URL = 'https://registry.npmjs.org/@deepseek-ai/dsh'

/** `x.y.z` of a version, or null. */
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
/**
 * The window's floor and ceiling tuples. Only the ends matter: tuple comparison
 * answers "is this release inside the window", which is the question the
 * harness's admission gate asks.
 */
function windowOf(range) {
  const lower = new Set()
  const upper = new Set()
  for (const match of range.matchAll(/(\^|~|>=|<=|>|<|=)?\s*v?(\d+)\.(\d+)\.(\d+)/g)) {
    const tuple = `${match[2]}.${match[3]}.${match[4]}`
    const operator = match[1] ?? '='
    if (operator === '<' || operator === '<=') upper.add(tuple)
    else lower.add(tuple)
  }
  const sorted = (set) => [...set].sort(compareTuples)
  return {
    floor: lower.size === 0 ? undefined : sorted(lower).at(-1),
    ceiling: upper.size === 0 ? undefined : sorted(upper)[0],
  }
}

// `engines.dsh` is what the harness reads; the peer list stays as metadata and
// as the fallback probe for a package that declares no window.
const enginesRange = MANIFEST.dsh?.engines?.dsh
const peers = Object.keys(MANIFEST.peerDependencies ?? {}).filter((name) => name.startsWith('@deepseek-ai/dsh'))
const declared = typeof enginesRange === 'string' && enginesRange !== '' ? enginesRange : MANIFEST.peerDependencies?.[peers[0]]
const declaredBy = typeof enginesRange === 'string' && enginesRange !== ''
  ? 'dsh.engines.dsh'
  : peers.length > 0 ? `peer ${peers[0]}` : undefined
if (declaredBy === undefined) {
  console.log('check-dsh-version: neither dsh.engines.dsh nor a @deepseek-ai/dsh-* peer is declared — nothing to track')
  process.exit(0)
}
const { floor, ceiling } = windowOf(declared)
if (floor === undefined) {
  console.error(`check-dsh-version: ${declaredBy} "${declared}" declares no lower bound; nothing to compare against`)
  process.exit(2)
}
/** Whether a published tuple falls inside the declared window. */
const inside = (tuple) => compareTuples(tuple, floor) >= 0 && (ceiling === undefined || compareTuples(tuple, ceiling) < 0)

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

console.log(`declared:     ${declaredBy} = "${declared}"`)
console.log(`window:       ${floor} <= dsh < ${ceiling ?? 'infinity'}${ceiling === undefined ? '  (unbounded: the next line is admitted the day it is published)' : ''}`)
for (const [tag, { version, tuple }] of [...published].sort((a, b) => compareTuples(a[1].tuple, b[1].tuple))) {
  console.log(`dist-tag:     ${tag.padEnd(8)} ${version}${inside(tuple) ? '' : '  <-- OUTSIDE the declared window'}`)
}

const outside = [...published].filter(([, { tuple }]) => !inside(tuple))
if (outside.length === 0) {
  console.log('OK: every published dist-tag is inside the declared window.')
  process.exit(0)
}

const [tag, { version }] = outside.sort((a, b) => compareTuples(a[1].tuple, b[1].tuple)).at(-1)
console.log(`ACTION NEEDED: DSH ${version} (tag "${tag}") is outside the declared window.`)
console.log('  1. Verify the plugin against that line: a local monorepo checkout of the tag')
console.log('     (docs/subsystems/ + packages/client/*/src) plus the published tarballs, which show')
console.log('     what the client panels and .d.ts actually shipped.')
console.log('  2. Move the window and the pins together — dsh.engines.dsh is the only range DSH reads:')
console.log('       dsh.engines.dsh: ">=<verified release> <next tuple>.0-0"')
console.log('     then point every @deepseek-ai/dsh-* devDependency at the verified release.')
console.log('  3. npm install → npm run check → release.')
process.exit(1)
