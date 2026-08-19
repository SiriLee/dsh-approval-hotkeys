#!/usr/bin/env node
/**
 * Built-artifact verification for dsh-approval-hotkeys. Runs after `npm run
 * build` and proves the tarball's loadable shape:
 *   1. the host half parses and exports the plugin `apply` entry;
 *   2. the client half carries the `window.__ModuleLoader__.load` handoff
 *      with the exact package id (what the harness web app consumes);
 *   3. both declaration files exist (types ship in the tarball).
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))

let failures = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — ${detail}`}`)
  if (!ok) failures += 1
}

// 1. host half: parseable ESM exporting `apply`
const host = await readFile(join(ROOT, 'lib', 'index.js'), 'utf8')
const exportBlock = host.slice(host.lastIndexOf('export {'))
check('host exports apply', exportBlock.includes('apply'), exportBlock.slice(0, 120))
// Import the host half like the dsh loader does (cwd is the package root).
const hostModule = await import(join(ROOT, 'lib', 'index.js'))
check('host apply is a function', typeof hostModule.apply === 'function', typeof hostModule.apply)

// 2. client half: ModuleLoader handoff with the package id
const client = await readFile(join(ROOT, 'lib', 'client.js'), 'utf8')
check('client has loader handoff', client.includes('window.__ModuleLoader__.load'), 'missing handoff')
check('client carries package id', client.includes(`id: ${JSON.stringify(pkg.name)}`), 'id mismatch')

// 3. declarations ship in the tarball
for (const dts of ['lib/types/index.d.ts', 'lib/types/client/index.d.ts']) {
  try {
    await readFile(join(ROOT, dts), 'utf8')
    check(`declaration ${dts} exists`, true, '')
  } catch {
    check(`declaration ${dts} exists`, false, 'missing')
  }
}

console.log(failures === 0 ? '\nverify:host: all checks passed' : `\nverify:host: ${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
