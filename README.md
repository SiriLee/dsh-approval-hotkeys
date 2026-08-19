# dsh-approval-hotkeys

Approval-panel hotkeys for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness),
for **every** approval source — not just edits.

> English | [中文](README.zh.md)

A deliberately minimal plugin with one generic rule: **Enter always presses
the confirm button (the primary, right-most action); Esc always presses the
cancel button** — on every button-bearing interaction panel the harness
renders.

| Panel | Enter → confirm | Esc → cancel |
| --- | --- | --- |
| Approval (`[data-approval-key]`) | Allow once | Reject |
| Question / choice (`[data-question-key]`) | Submit / Next | Discard the group |
| Plan review (`[data-plan-review-key]`) | Approve | Decline (or discuss) |

The panel anchors are harness-generic, so the hotkeys work on every
interaction the GUI shows — edit approvals, permission escalations, tool
questions, plan reviews. This is the Claude Code habit: confirm with Enter,
refuse with Esc.

## Install

```sh
dsh plugin --profile web add dsh-approval-hotkeys
```

Restart `dsh web` (or refresh the page — the client bundle reloads on refresh
when the host side did not change). No configuration, no settings page.

## How it works

- **Enter → confirm**: clicks the panel's primary button — the last button
  of its action row ("Allow once", "Submit/Next", "Approve"). The harness's
  `Button` component has no stable `data-variant` attribute (variants are
  CSS-Modules hash classes), so the plugin anchors on the layout contract
  that the confirm action always renders last — which is exactly the
  primary-colored button.
- **Esc → cancel**: clicks the panel's cancel button — Reject (first),
  Discard (header), Decline (footer second-last, or Discuss when the panel
  has no decline action). Without a panel, Esc is left alone (no pause/stop
  binding — the GUI's own stop button and shortcuts own that).

### Guards (what the plugin deliberately does NOT do)

- **Never while typing**: keydown inside an input / textarea / select /
  contentEditable (the composer owns `Enter`/`Esc` there — e.g.
  `Shift+Enter` newline, `Esc` dismisses suggestions).
- **Enter with focus on a button**: left to the browser (it activates the
  focused button natively) and to the panel itself (the question composer's
  options submit on Enter) — acting again would double-fire.
- **Never on chords or repeats**: `Ctrl/Meta/Alt+key` combinations and
  held-key repeats are left alone.
- **Esc with no panel**: left alone — the plugin never stops or pauses the
  agent; panels are the only surface it acts on.

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
