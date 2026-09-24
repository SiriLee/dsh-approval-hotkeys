#!/usr/bin/env node
/**
 * Built-artifact verification for dsh-approval-hotkeys. Runs after `npm run
 * build` and proves what the *tarball* can do — not what `src/` can do:
 *
 *   1. the `dsh.client` declaration describes a loadable browser package
 *      (platform, `./client` export, resolvable `inject` edges);
 *   2. the host half parses as ESM and exports the plugin `apply` entry;
 *   3. the client half registers under the handoff the web boot installs
 *      (`window.__ModuleLoader__.load`), keyed by the package id — the
 *      registration key must equal the boot graph row id;
 *   4. the client half is self-contained (no harness module, no `require`);
 *   5. the client half actually *runs*: materializing the registered factory
 *      yields the plugin face, and mounting it on a 0.1.7-shaped client ctx
 *      answers the pending approval on Enter, cancels on Esc, stays out of the
 *      way when the runtime reports nothing awaiting an answer, falls back to
 *      the DOM when the runtime cancels surface is unreadable, and unbinds on
 *      dispose.
 *
 * Step 5 is the client-only analogue of the sister plugin's `verify-host`
 * (which boots the built host half on a real cordis context): the artifact is
 * exercised, so a build that compiles but ships the wrong wiring fails here.
 */
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — ${detail}`}`)
  if (!ok) failures += 1
}

// 1. the dsh.client declaration
check('dsh.client.platform is web', pkg.dsh?.client?.platform === 'web', String(pkg.dsh?.client?.platform))
check('exports a ./client bundle', typeof pkg.exports?.['./client']?.default === 'string', 'missing')
check(
  'declared dsh runtime floor',
  typeof pkg.dsh?.engines?.dsh === 'string' && pkg.dsh.engines.dsh !== '',
  String(pkg.dsh?.engines?.dsh),
)

// The card's display text comes from the package's own dictionaries: the
// manager resolves `<specifier>/locale/en.json` as the anchor, then every
// sibling through the exports map. Without the anchor, the export, or the file
// glob the card silently falls back to the raw package name and description,
// so the three travel as one check.
const localeDir = join(ROOT, 'locale')
const dictionaries = (await readdir(localeDir)).filter((name) => name.endsWith('.json'))
const localized = []
for (const name of dictionaries) {
  const meta = JSON.parse(await readFile(join(localeDir, name), 'utf8')).meta
  const text = (value) => typeof value === 'string' && value.trim() !== ''
  if (text(meta?.title) && text(meta?.description)) localized.push(name.replace(/\.json$/u, ''))
}
check(
  'locale card metadata resolves (anchor + export + text)',
  dictionaries.includes('en.json')
    && typeof pkg.exports?.['./locale/*.json'] === 'string'
    && (pkg.files ?? []).includes('locale/*.json')
    && localized.length === dictionaries.length,
  `languages: ${localized.join(', ') || 'none'}`,
)

// 2. host half: parseable ESM exporting `apply`
const host = await readFile(join(ROOT, 'lib', 'index.js'), 'utf8')
const exportBlock = host.slice(host.lastIndexOf('export {'))
check('host exports apply', exportBlock.includes('apply'), exportBlock.slice(0, 120))
// Import the host half like the dsh loader does (cwd is the package root).
const hostModule = await import(join(ROOT, 'lib', 'index.js'))
check('host apply is a function', typeof hostModule.apply === 'function', typeof hostModule.apply)

// 3. client half: ModuleLoader handoff with the package id
const client = await readFile(join(ROOT, 'lib', 'client.js'), 'utf8')
check('client has loader handoff', client.includes('window.__ModuleLoader__.load'), 'missing handoff')
check('client carries package id', client.includes(`id: ${JSON.stringify(pkg.name)}`), 'id mismatch')

// 4. self-containment
check('client references no harness package', !client.includes('@deepseek-ai/'), 'harness import inlined')
check('client calls no require()', !/\brequire\s*\(/.test(client), 'require() call in bundle')

// 5. the client half, loaded and run against a 0.1.7-shaped runtime
const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' })
const { window } = dom
const registrations = []
window.__ModuleLoader__ = {
  mode: 'queue',
  pendingQueue: registrations,
  load: (registration) => registrations.push(registration),
  create() {},
}
window.eval(client)
const registration = registrations.find((candidate) => candidate.id === pkg.name)
check('client registers under the package id', registration !== undefined, `registered: ${registrations.map((r) => r.id).join(', ') || 'none'}`)

if (registration !== undefined) {
  const face = registration.factory(() => {
    throw new Error('the client half must not require an external module')
  })
  check('client exports apply/inject', typeof face.apply === 'function' && Array.isArray(face.inject), Object.keys(face).join(', '))
  check('client injects the sessions service', face.inject?.includes('sessions') === true, JSON.stringify(face.inject))

  const { document } = window
  /** One approval panel: [Reject] [Allow once]. */
  const panel = (key) => {
    const root = document.createElement('div')
    root.setAttribute('data-approval-key', key)
    const reject = document.createElement('button')
    reject.textContent = 'Reject'
    const allowOnce = document.createElement('button')
    allowOnce.textContent = 'Allow once'
    root.append(reject, allowOnce)
    document.body.append(root)
    const clicks = []
    reject.addEventListener('click', () => clicks.push('reject'))
    allowOnce.addEventListener('click', () => clicks.push('allow-once'))
    return { clicks }
  }
  const key = (name) => {
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
  }
  /** Mount the plugin on a ctx whose two runtime surfaces are supplied. */
  const mount = (pending) => {
    const disposers = []
    const ctx = {
      sessions: { list: { getSnapshot: () => ({ byId: { viewed: { retainedBy: { mainView: 1 } } } }) } },
      get: (name) =>
        name !== 'uiSession' || pending === undefined
          ? undefined
          : { sessionStatus: { getSnapshot: () => new Map([['viewed', pending]]) } },
      effect: (fn) => {
        const iterator = fn()
        for (let step = iterator.next(); step.done !== true; step = iterator.next()) disposers.push(step.value)
      },
    }
    face.apply(ctx)
    return () => {
      for (const dispose of disposers) dispose()
    }
  }

  const awaiting = panel('approval:1')
  let unmount = mount({ pendingInteraction: { kind: 'approval', key: 'approval:1' } })
  key('Enter')
  check('Enter answers the awaiting approval', awaiting.clicks.join() === 'allow-once', awaiting.clicks.join() || 'no click')
  awaiting.clicks.length = 0
  key('Escape')
  check('Esc rejects the awaiting approval', awaiting.clicks.join() === 'reject', awaiting.clicks.join() || 'no click')
  awaiting.clicks.length = 0
  unmount()

  // A settled or foreign panel must not be answered from a positional guess.
  unmount = mount({})
  key('Enter')
  check('no answer while the runtime reports nothing awaiting one', awaiting.clicks.length === 0, awaiting.clicks.join())
  unmount()

  // Without the runtime surface the DOM fallback keeps working.
  unmount = mount(undefined)
  key('Enter')
  check('DOM fallback answers when the runtime surface is absent', awaiting.clicks.join() === 'allow-once', awaiting.clicks.join() || 'no click')
  unmount()

  // Dispose unbinds: a later keydown must not reach the removed listener.
  awaiting.clicks.length = 0
  unmount = mount({ pendingInteraction: { kind: 'approval', key: 'approval:1' } })
  unmount()
  key('Enter')
  check('dispose unbinds the keydown listener', awaiting.clicks.length === 0, awaiting.clicks.join() || 'no click')
}

// 6. declarations ship in the tarball
for (const dts of ['lib/types/index.d.ts', 'lib/types/client/index.d.ts', 'lib/types/client/contract.d.ts']) {
  try {
    await readFile(join(ROOT, dts), 'utf8')
    check(`declaration ${dts} exists`, true)
  } catch {
    check(`declaration ${dts} exists`, false, 'missing')
  }
}

console.log(failures === 0 ? '\nverify:host: all checks passed' : `\nverify:host: ${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
