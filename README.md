# dsh-approval-hotkeys

Approval-panel hotkeys for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness),
for **every** approval source — not just edits.

> English | [中文](README.zh.md)

A deliberately minimal plugin: two keys, two scenarios.

| Key | Scenario | Action |
| --- | --- | --- |
| `Enter` | Approval panel present | **Approve once** (click "Allow once") |
| `Esc` | Approval panel present | **Reject** (click "Reject") |
| `Esc` | No panel, agent running | **Pause** (stop the running turn; queued work is preserved) |

The approval panel's `[data-approval-key]` anchor is harness-generic, so the
hotkeys work on every approval the GUI shows — edit approvals, permission
escalations, anything routed through the ApprovalPanel. This is the Claude
Code habit: approve with Enter, refuse with Esc.

## Install

```sh
dsh plugin --profile web add dsh-approval-hotkeys
```

Restart `dsh web` (or refresh the page — the client bundle reloads on refresh
when the host side did not change). No configuration, no settings page.

## How it works

- **Enter → approve once**: clicks the panel's last button (`Allow once`).
- **Esc → reject**: clicks the panel's first button (`Reject`).
- **Esc → pause**: calls `session.cancel()` — the same verb as the GUI's
  *stop generating* button; the running turn stops and pending queued
  messages resume in FIFO order afterwards.

### Guards (what the plugin deliberately does NOT do)

- **Never while typing**: keydown inside an input / textarea / select /
  contentEditable (the composer owns `Enter`/`Esc` there — e.g.
  `Shift+Enter` newline, `Esc` dismisses suggestions).
- **Never on chords or repeats**: `Ctrl/Meta/Alt+key` combinations and held-key
  repeats are left alone.
- **Esc never pauses under a dialog**: while a `role="dialog"` overlay (e.g.
  settings) is open, `Esc` belongs to the dialog.
- **Panel wins over pause**: with a panel open, `Esc` always rejects — it
  never pauses.

### Design notes

- Pure browser (client) plugin: the host half is a no-op stub. All behavior
  is a single `document` `keydown` listener registered inside one
  `ctx.effect`, torn down on unload/HMR.
- Relies on the stable ApprovalPanel DOM contract: reject renders first,
  allow-once last, both `disabled` after an answer — so a double-answer is
  impossible and the button-order dependency is the only harness coupling.
- The panel lookup prefers the current session's pending approval key and
  falls back to the first panel in DOM order.

## Development

```sh
npm install
npm run typecheck   # tsc --noEmit (host + client)
npm test            # vitest (jsdom unit tests for the dispatch logic)
npm run build       # esbuild: lib/index.js + lib/client.js + .d.ts
node scripts/verify-host.mjs
```

## Release

The first publish is manual (`npm publish --access public`), then the
GitHub Actions **Trusted Publishing** workflow takes over — push a `v<semver>`
tag and CI publishes with provenance. Full steps: [docs/release.md](docs/release.md).

## License

[MIT](LICENSE)
