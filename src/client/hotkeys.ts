/**
 * dsh-approval-hotkeys — keydown dispatch core (browser half, pure DOM).
 *
 * Pure logic, unit-tested with jsdom. One document-level keydown listener
 * implements a generic rule over every button-bearing interaction panel the
 * harness renders (identified by stable data-attribute anchors):
 *
 *   Enter → confirm  — click the panel's confirm button (the right-most /
 *                      primary action: "Allow once", "Submit", "Approve").
 *   Esc   → cancel   — click the panel's cancel button (reject / discard /
 *                      decline).
 *   none  → leave the event alone.
 *
 * Guards: synthetic repeats, Ctrl/Meta/Alt chords, and keystrokes inside
 * editable seats (composer textarea, inputs, contentEditable) are never
 * ours — the composer owns Enter and Esc there. Enter with focus on a
 * button is also left alone: the browser activates the focused button
 * natively, and the question composer submits on Enter itself — acting
 * again would double-fire.
 *
 * @module dsh-approval-hotkeys/hotkeys
 */

import type { SessionFace } from '@deepseek-ai/dsh-client-runtime/client'

/** How to locate a panel's confirm / cancel button. */
type ButtonLocator = 'first' | 'last' | 'header-last' | 'footer-last' | 'footer-second-last'

/** One panel kind: stable DOM anchor + confirm/cancel locators. */
interface PanelKind {
  /** Root selector of the panel. */
  readonly selector: string
  /** Data attribute carrying the pending key (for current-session matching). */
  readonly keyAttr: string
  /** The pending-interaction kind matching this panel (approval/question). */
  readonly pendingKind?: 'approval' | 'question'
  /** Enter target: the confirm action (right-most / primary). */
  readonly confirm: ButtonLocator
  /** Esc target: the cancel action (reject / discard / decline). */
  readonly cancel: ButtonLocator
}

/**
 * The panel kinds this plugin understands. The ApprovalPanel renders
 * [Reject] [Allow once]; the QuestionComposer renders a header (minimize,
 * discard) + options + a footer (skip, submit/next); the PlanReviewPanel
 * renders a footer (discuss, decline?, approve).
 */
const PANEL_KINDS: readonly PanelKind[] = [
  { selector: '[data-approval-key]', keyAttr: 'approval', pendingKind: 'approval', confirm: 'last', cancel: 'first' },
  { selector: '[data-question-key]', keyAttr: 'question', pendingKind: 'question', confirm: 'footer-last', cancel: 'header-last' },
  { selector: '[data-plan-review-key]', keyAttr: 'plan-review', confirm: 'footer-last', cancel: 'footer-second-last' },
]

/** The outcome of one keydown dispatch. */
export type HotkeyAction = 'confirm' | 'cancel' | 'none'

/** Editable seats where Enter/Esc belong to the composer / inputs, not to us. */
function isEditable(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return true
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLSelectElement) return true
  if (target instanceof HTMLElement && target.isContentEditable) return true
  return false
}

/** Synthetic repeats and chorded shortcuts are never ours. */
function isChord(event: KeyboardEvent): boolean {
  return event.repeat || event.ctrlKey || event.metaKey || event.altKey
}

/** Whether the event target sits on/inside a button (native activation owns Enter there). */
function isButtonTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button') !== null
}

/**
 * The visible interaction panel, with its kind. Prefers the current
 * session's pending interaction key (the conversation the user is looking
 * at), falling back to the first panel in DOM order — panels render inline
 * in the conversation stream, so the fallback is what the user sees.
 */
export function findPanel(session: SessionFace | undefined): { element: HTMLElement; kind: PanelKind } | null {
  if (session !== undefined) {
    for (const item of session.getSnapshot().pending) {
      const kind = PANEL_KINDS.find((candidate) => candidate.pendingKind === item.kind)
      if (kind === undefined) continue
      const panel = document.querySelector<HTMLElement>(`${kind.selector}[data-${kind.keyAttr}-key="${item.key}"]`)
      if (panel !== null) return { element: panel, kind }
    }
  }
  for (const kind of PANEL_KINDS) {
    const panel = document.querySelector<HTMLElement>(kind.selector)
    if (panel !== null) return { element: panel, kind }
  }
  return null
}

/** Resolve one button inside the panel by locator; enabled buttons only. */
function locateButton(panel: HTMLElement, locator: ButtonLocator): HTMLButtonElement | null {
  let list: NodeListOf<HTMLButtonElement>
  let index: number
  if (locator === 'header-last' || locator === 'footer-last' || locator === 'footer-second-last') {
    const scope = panel.querySelector(locator.startsWith('header') ? 'header' : 'footer')
    if (scope === null) return null
    list = scope.querySelectorAll('button')
    index = locator === 'footer-second-last' ? list.length - 2 : list.length - 1
  } else {
    list = panel.querySelectorAll('button')
    index = locator === 'first' ? 0 : list.length - 1
  }
  const button = list[index]
  if (button === undefined) return null
  return button instanceof HTMLButtonElement && !button.disabled ? button : null
}

/**
 * Decide one keydown event. `session` is the current session face (may be
 * undefined when no session is selected); returns the action taken so the
 * caller can `preventDefault()`.
 */
export function dispatch(event: KeyboardEvent, session: SessionFace | undefined): HotkeyAction {
  if (isChord(event) || isEditable(event.target)) return 'none'
  const panel = findPanel(session)
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
