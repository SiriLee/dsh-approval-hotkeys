/**
 * dsh-approval-hotkeys — keydown dispatch core (browser half, pure DOM).
 *
 * One document-level keydown listener implements a generic rule over every
 * button-bearing interaction panel the harness renders (identified by stable
 * data-attribute anchors):
 *
 *   Enter → confirm  — click the panel's confirm button (the right-most /
 *                      primary action: "Allow once", "Submit", "Approve").
 *   Esc   → cancel   — click the panel's cancel button (reject / discard /
 *                      decline).
 *   none  → leave the event alone.
 *
 * Panel identity comes from the runtime's own pending-interaction fact
 * (`target.ts` resolves it for the session the main view retains), and the
 * three verdicts are not interchangeable:
 *
 *   'pending' — locate exactly that request by its key. A request that is
 *               awaiting an answer but has no panel on screen is not ours to
 *               answer (it belongs to a background session, or is mid-mount),
 *               so there is no positional guessing.
 *   'idle'    — the runtime was readable and reports nothing awaiting an answer
 *               here; stay out of the way even if a settled or foreign panel
 *               lingers in the DOM.
 *   'unknown' — no runtime authority (older host, service absent). Fall back to
 *               the first *visible* panel in DOM order, which is what this
 *               plugin did before it could read the runtime at all.
 *
 * Guards: synthetic repeats, Ctrl/Meta/Alt chords, IME composition (a
 * candidate-confirming Enter must never answer a panel), and keystrokes inside
 * editable seats (composer editor, inputs, contentEditable) are never ours —
 * the composer owns Enter and Esc there. Enter with focus on a button is also
 * left alone: the browser activates the focused button natively, and the
 * question composer submits on Enter itself — acting again would double-fire.
 *
 * Button resolution skips tool buttons declared as non-hotkey targets: any
 * plugin may mark a button with `data-hotkey="none"` (e.g. a diff collapse
 * toggle injected ahead of the action row) to opt it out of Enter/Esc
 * position-based resolution — so the hotkeys only ever land on the panel's real
 * confirm/cancel actions. Locators count from the END of their container, so
 * buttons a plugin injects *before* the actions (the plan-review
 * `conversation.plan-review.actions` slot renders inside the panel strip) do not
 * shift the target.
 *
 * Visibility: a panel inside an `inert` or `hidden` subtree, or hidden through
 * `visibility: hidden`, is not answerable — a settling conversation keeps its
 * composer seat in the DOM that way, and both `inert` and `visibility: hidden`
 * leave `offsetParent` set, so those cases need explicit checks.
 *
 * @module dsh-approval-hotkeys/hotkeys
 */

import { UNKNOWN_TARGET, type TargetResolution } from './target.ts'

/**
 * Selector for opt-out utility controls (tool buttons, decorative buttons)
 * that must not be treated as hotkey targets. Any plugin can mark a button
 * with this attribute (e.g. a diff collapse toggle) to exclude it from
 * position-based Enter/Esc resolution.
 */
const HOTKEY_IGNORE = '[data-hotkey="none"]'

/** How to locate a panel's confirm / cancel button. */
type ButtonLocator = 'first' | 'last' | 'second-last' | 'header-last' | 'footer-last' | 'footer-second-last'

/** One panel kind: stable DOM anchor + confirm/cancel locators. */
interface PanelKind {
  /** Root selector of the panel. */
  readonly selector: string
  /** Data attribute carrying the pending key (for request-key matching). */
  readonly keyAttr: string
  /** The pending-interaction kind rendered by this panel. */
  readonly pendingKind: 'approval' | 'question' | 'plan-review'
  /** Enter target: the confirm action (right-most / primary). */
  readonly confirm: ButtonLocator
  /** Esc target: the cancel action (reject / discard / decline). */
  readonly cancel: ButtonLocator
}

/**
 * The panel kinds this plugin understands. The ApprovalPanel renders
 * [Reject] [Allow once]; the QuestionComposer renders a `<header>`
 * (minimize, discard) + options + a `<footer>` (skip, submit/next); the
 * PlanReviewPanel renders its strip (state, title, the plugin-owned
 * `conversation.plan-review.actions` slot) + a plain `<div className="…
 * footer">` (NOT a `<footer>` tag) holding discuss / approve — so the
 * plan-review actions are located panel-wide, counted from the end.
 */
const PANEL_KINDS: readonly PanelKind[] = [
  { selector: '[data-approval-key]', keyAttr: 'approval', pendingKind: 'approval', confirm: 'last', cancel: 'first' },
  { selector: '[data-question-key]', keyAttr: 'question', pendingKind: 'question', confirm: 'footer-last', cancel: 'header-last' },
  { selector: '[data-plan-review-key]', keyAttr: 'plan-review', pendingKind: 'plan-review', confirm: 'last', cancel: 'second-last' },
]

/** The outcome of one keydown dispatch. */
export type HotkeyAction = 'confirm' | 'cancel' | 'none'

/** One resolved panel: its root element and the kind that matched it. */
export interface PanelHit {
  readonly element: HTMLElement
  readonly kind: PanelKind
}

/**
 * `checkVisibility` is newer than the oldest engine this plugin supports, and
 * its option name has churned; probe it structurally rather than depending on a
 * TypeScript DOM lib vintage.
 */
interface VisibilityProbe {
  checkVisibility?(options?: { checkVisibilityCSS?: boolean }): boolean
}

/** Editable seats where Enter/Esc belong to the composer / inputs, not to us. */
function isEditable(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return true
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLSelectElement) return true
  if (target instanceof HTMLElement) {
    // The composer is a contentEditable editor. `isContentEditable` is true for
    // its descendants too; the attribute test backs it up for engines (and test
    // DOMs) that do not implement the IDL property, and covers
    // `plaintext-only`. A `contenteditable="false"` island inside the editor
    // still reads as editable here — refusing the hotkey there is the safe side.
    if (target.isContentEditable) return true
    if (target.closest('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]') !== null) {
      return true
    }
  }
  return false
}

/** Synthetic repeats and chorded shortcuts are never ours. */
function isChord(event: KeyboardEvent): boolean {
  return event.repeat || event.ctrlKey || event.metaKey || event.altKey
}

/**
 * IME composition owns Enter: engines report it through `isComposing`, and the
 * legacy `keyCode` 229 signal covers engines that emit it without that flag.
 */
function isComposing(event: KeyboardEvent): boolean {
  return event.isComposing === true || (event as KeyboardEvent & { keyCode?: number }).keyCode === 229
}

/** Whether the event target sits on/inside a button (native activation owns Enter there). */
function isButtonTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button') !== null
}

/**
 * Whether a panel is actually answerable: not inside an `inert` or `hidden`
 * subtree, and not hidden through `visibility: hidden`. Elements that fail this
 * test are still returned by `querySelectorAll`, and clicking one would answer a
 * request the user cannot see.
 */
function isAnswerable(element: HTMLElement): boolean {
  if (element.closest('[inert]') !== null) return false
  if (element.closest('[hidden]') !== null) return false
  const probe = element as HTMLElement & VisibilityProbe
  if (typeof probe.checkVisibility === 'function') {
    // checkVisibilityCSS also rejects the `visibility: hidden` case.
    return probe.checkVisibility({ checkVisibilityCSS: true })
  }
  return true
}

/** The panel carrying `key`, or null when it is absent or not answerable. */
function panelByKey(kind: PanelKind, key: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(kind.selector)) {
    if (element.getAttribute(`data-${kind.keyAttr}-key`) === key && isAnswerable(element)) return element
  }
  return null
}

/** The first answerable panel of one kind, in DOM order. */
function firstAnswerable(selector: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    if (isAnswerable(element)) return element
  }
  return null
}

/**
 * The panel to act on, per the runtime verdict.
 *
 * @param target - the runtime's verdict for the conversation on screen.
 * @returns the panel and its kind, or null when nothing is answerable.
 */
export function findPanel(target: TargetResolution): PanelHit | null {
  if (target.state === 'pending') {
    const kind = PANEL_KINDS.find((candidate) => candidate.pendingKind === target.item.kind)
    // A runtime request in a domain this plugin does not render (or a renamed
    // domain): leave it alone rather than clicking through a positional guess.
    if (kind === undefined) return null
    const element = panelByKey(kind, target.item.key)
    return element === null ? null : { element, kind }
  }
  if (target.state === 'idle') return null
  for (const kind of PANEL_KINDS) {
    const element = firstAnswerable(kind.selector)
    if (element !== null) return { element, kind }
  }
  return null
}

/** The panel's buttons, excluding opt-out utility controls (e.g. a diff collapse toggle). */
function buttonsOf(scope: ParentNode): NodeListOf<HTMLButtonElement> {
  return scope.querySelectorAll<HTMLButtonElement>(`button:not(${HOTKEY_IGNORE})`)
}

/** Resolve one button inside the panel by locator; enabled buttons only. */
function locateButton(panel: HTMLElement, locator: ButtonLocator): HTMLButtonElement | null {
  let list: NodeListOf<HTMLButtonElement>
  let index: number
  if (locator === 'header-last' || locator === 'footer-last' || locator === 'footer-second-last') {
    // Tag-scoped locators: QuestionComposer renders real `<header>`/`<footer>`
    // tags. PlanReviewPanel does NOT (its footer is a `div`), so it uses the
    // panel-wide locators below instead.
    const scope = panel.querySelector(locator.startsWith('header') ? 'header' : 'footer')
    if (scope === null) return null
    list = buttonsOf(scope)
    index = locator === 'footer-second-last' ? list.length - 2 : list.length - 1
  } else {
    // Panel-wide locators, counted from the end: the approval action row, and
    // the plan-review strip + div-footer actions (prefix injections in the
    // strip slot cannot shift a suffix locator).
    list = buttonsOf(panel)
    index = locator === 'first' ? 0 : locator === 'second-last' ? list.length - 2 : list.length - 1
  }
  const button = list[index]
  if (button === undefined) return null
  return button instanceof HTMLButtonElement && !button.disabled ? button : null
}

/**
 * Decide one keydown event. `target` is the runtime's verdict for the
 * conversation on screen (defaults to `'unknown'`, the DOM-only behavior);
 * returns the action taken so the caller can `preventDefault()`.
 *
 * @param event - the document-level keydown.
 * @param target - the runtime's verdict for the conversation on screen.
 * @returns the action taken.
 */
export function dispatch(event: KeyboardEvent, target: TargetResolution = UNKNOWN_TARGET): HotkeyAction {
  if (isChord(event) || isComposing(event) || isEditable(event.target)) return 'none'
  const panel = findPanel(target)
  if (event.key === 'Enter') {
    // Focus inside a button: the browser (or the panel itself, e.g. the
    // question composer's options) already handles Enter — acting again
    // would double-fire.
    if (isButtonTarget(event.target)) return 'none'
    const confirm = panel === null ? null : locateButton(panel.element, panel.kind.confirm)
    if (confirm === null) return 'none'
    confirm.click()
    return 'confirm'
  }
  if (event.key === 'Escape') {
    if (panel === null) return 'none'
    const cancel = locateButton(panel.element, panel.kind.cancel)
    if (cancel === null) return 'none'
    cancel.click()
    return 'cancel'
  }
  return 'none'
}
