# dsh-approval-hotkeys

[![npm version](https://img.shields.io/npm/v/dsh-approval-hotkeys.svg)](https://www.npmjs.com/package/dsh-approval-hotkeys)
[![npm license](https://img.shields.io/npm/l/dsh-approval-hotkeys.svg)](https://github.com/SiriLee/dsh-approval-hotkeys/blob/main/LICENSE)

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

### Approval panel

Every approval — edits, permission escalations, anything routed through the
ApprovalPanel. **Enter** presses *Allow once*, **Esc** presses *Reject*.

<p align="center">
  <img src="assets/screenshots/approval-panel.png" width="680" alt="Approval panel — Enter: Allow once, Esc: Reject"/>
</p>

### Question / choice panel

Tool questions (`ask_user_question`). **Enter** presses *Submit / Next*,
**Esc** presses *Discard the group*.

<p align="center">
  <img src="assets/screenshots/question-panel.png" width="680" alt="Question panel — Enter: Submit, Esc: Discard the group"/>
</p>

### Plan review panel

**Enter** presses *Approve*, **Esc** presses *Decline* (or *Discuss* when
the panel has no decline action).

<p align="center">
  <img src="assets/screenshots/plan-review-panel.png" width="680" alt="Plan review panel — Enter: Approve, Esc: Decline"/>
</p>

## Install

```sh
dsh plugin --profile web add dsh-approval-hotkeys
```

Restart `dsh web` — or, since this plugin is pure browser-side, just refresh the page when the host side did not change. No configuration, no settings page.

Supported harness versions: **DSH `0.2.0-rc.2` up to (not including) `0.3.0`**, declared as `dsh.engines.dsh` and verified against both ends (`0.2.0-rc.2`, npm `latest`, and `0.2.1-alpha.5`, npm `alpha`). Since DSH 0.2.x that one field decides plugin admission **alone** — the harness ignores peer ranges when it is present — and a release whose window does not admit the running version is **skipped entirely** at startup, so the window carries a ceiling instead of admitting an unverified future line. A release targets one DSH line; older lines are served by the release frozen on them. See [docs/release.md](docs/release.md).

Why this plugin still exists: the harness now ships approval hotkeys of its own, but they are bound to the panel element and fire only once focus is inside it (`currentTarget.contains(document.activeElement)`) — the user has to click the panel first. This plugin covers the missing case (panel on screen, focus anywhere else), and the two cannot double-fire: the harness handler calls `preventDefault()` and `stopPropagation()` from inside the React root, while this listener sits on `document`, above it, and also ignores an already-prevented key.

For contributors: install from a local checkout or a pinned commit — `dsh plugin --profile web add /path/to/dsh-approval-hotkeys` or `dsh plugin --profile web add github:SiriLee/dsh-approval-hotkeys#<sha>`. A git install fails on first run until you add an `allowBuilds` key to the profile's `pnpm-workspace.yaml` (pnpm blocks git dependencies from running build scripts); after that it runs the plugin's `prepare` and installs it.

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
- **Never mid-composition**: an IME-confirming `Enter` (`isComposing`, or the
  legacy `keyCode` 229) is a candidate pick, not an answer.
- **Esc with no panel**: left alone — the plugin never stops or pauses the
  agent; panels are the only surface it acts on.
- **Never on a panel the runtime does not vouch for**: when the runtime reports
  what is awaiting an answer here, that request is the only thing the hotkeys
  answer — a settled or foreign panel left in the DOM is not clicked through a
  positional guess.

### Button resolution contract (`data-hotkey="none"`)

Enter/Esc resolve their buttons **by position** (first / last / header-last /
footer-last), not by a stable semantic attribute — the harness's `Button`
component exposes no reliable `data-role`/`data-variant`, so position is the
only stable signal available to a client plugin that does not own the panel
DOM. That makes button order the single coupling point to the harness layout.

To keep that coupling safe when **other plugins** inject buttons into a panel
(utility toggles, decorative controls), this plugin skips any button marked
`data-hotkey="none"` when resolving the confirm/cancel action. Any plugin that
adds a non-action button into an interaction panel **should** mark it:

```html
<button data-hotkey="none">Collapse diff</button>
```

This is a **cooperative, opt-out contract**, not a hard guarantee. It reliably
covers "a plugin inserts an extra non-action button ahead of the action row"
(such as dsh-edit-approval's diff collapse toggle). It does **not** cover:

- a plugin that injects a button **without** the marker (contract ignored), or
- a plugin that **reorders / inserts a genuinely actionable button** among the
  real confirm/cancel buttons (the semantics changed, not just a decoration
  added), or
- a change to the harness's own panel layout.

Those cases need a stable semantic anchor in the harness panel DOM (e.g.
`data-role="confirm"` / `data-role="cancel"`) — a harness-repo change, not a
client-plugin fix. File an issue / PR against deepseek-harness if it bites.

### Design notes

- Pure browser (client) plugin: the host half is a no-op stub. All behavior
  is a single `document` `keydown` listener registered inside one
  `ctx.effect`, torn down on unload/HMR.
- Relies on the stable ApprovalPanel DOM contract: reject renders first,
  allow-once last, both `disabled` after an answer — so a double-answer is
  impossible and the button-order dependency is the only harness coupling.
- The panel lookup asks the runtime first: `uiSession.sessionStatus` names the
  request awaiting an answer for the session the main view retains
  (`sessions.list` → `retainedBy.mainView`, the signal that replaced
  `SessionListState.current`), and the panel is then located by that request
  key. A readable runtime that reports nothing awaiting an answer means the
  hotkeys stay out of the way; only an **unreadable** runtime (no `uiSession`,
  a renamed snapshot field — i.e. an older or newer host) falls back to the
  first *visible* panel in DOM order.
- Panels are only answerable when actually on screen: a panel inside an
  `inert` or `hidden` subtree, or hidden through `visibility: hidden`, is never
  clicked. (`inert` and `visibility` both leave `offsetParent` set, so those
  cases need explicit checks rather than the usual visibility test.)
- `src/client/contract.ts` pins the harness shapes this reads at compile time.
  Without it, `skipLibCheck` would silently turn a moved or renamed type into
  `any` and the typecheck would keep passing while every read went unchecked.

## Development

```sh
npm install
npm run typecheck   # tsc --noEmit (host + client + the contract pins)
npm test            # vitest (dispatch + target-resolution unit tests)
npm run build       # esbuild: lib/index.js + lib/client.js + .d.ts
node scripts/verify-host.mjs   # exercises the built artifacts
npm run check       # all of the above + npm pack --dry-run
```

## Release

The first publish is manual (`npm publish --access public`), then the
GitHub Actions **Trusted Publishing** workflow takes over — push a `v<semver>`
tag and CI publishes with provenance. Full steps: [docs/release.md](docs/release.md).

## Security

Pure browser-side plugin: the host half is an empty stub, and all behavior is a document-level keydown listener that clicks existing panel buttons. No network requests, no file access, no credentials.

## License

[MIT](LICENSE)
