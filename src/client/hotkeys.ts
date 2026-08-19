/**
 * dsh-approval-hotkeys — keydown dispatch core (browser half, pure DOM).
 *
 * Pure logic, unit-tested with jsdom. One document-level keydown listener
 * decides between four outcomes for every approval panel (the harness's
 * generic `[data-approval-key]` anchor, so ALL approval sources — edits,
 * permission escalations, anything routed through the ApprovalPanel — are
 * covered, not just edit approvals):
 *
 *   Enter → approve once   — click the panel's LAST button ("Allow once").
 *   Esc   → reject         — click the panel's FIRST button ("Reject") when
 *                            an approval panel is present.
 *   Esc   → pause          — `session.cancel()` (stop the running turn;
 *                            queued work is preserved) when no panel is
 *                            present and the agent is running.
 *   none  → leave the event alone.
 *
 * Guards: synthetic repeats, Ctrl/Meta/Alt chords, and keystrokes inside
 * editable seats (composer textarea, inputs, contentEditable) are never
 * ours — the composer owns Enter and Esc there. While a `role="dialog"`
 * overlay is open, Esc belongs to the dialog (e.g. the settings page).
 *
 * @module dsh-approval-hotkeys/hotkeys
 */

import type { SessionFace } from '@deepseek-ai/dsh-client-runtime/client'

/** The approval panel root anchor (set by ApprovalPanel.tsx). */
export const PANEL_SELECTOR = '[data-approval-key]'

/** Modal overlays: while one is open, Esc belongs to the dialog, not to us. */
const DIALOG_SELECTOR = '[role="dialog"]'

/** The outcome of one keydown dispatch. */
export type HotkeyAction = 'approve' | 'reject' | 'pause' | 'none'

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

/** Approval keys currently pending on the session (their `key` matches `data-approval-key`). */
function pendingApprovalKeys(session: SessionFace | undefined): readonly string[] {
  if (session === undefined) return []
  return session
    .getSnapshot()
    .pending.filter((item) => item.kind === 'approval')
    .map((item) => item.key)
}

/**
 * The visible approval panel. Prefers a panel whose `data-approval-key`
 * matches the current session's pending approval (the conversation the user
 * is looking at), falling back to the first approval panel in DOM order —
 * panels render inline in the conversation stream, so the fallback is what
 * the user sees on screen.
 */
export function findApprovalPanel(session: SessionFace | undefined): HTMLElement | null {
  for (const key of pendingApprovalKeys(session)) {
    const panel = document.querySelector<HTMLElement>(`[data-approval-key="${key}"]`)
    if (panel !== null) return panel
  }
  return document.querySelector<HTMLElement>(PANEL_SELECTOR)
}

/**
 * The panel's reject (first) or allow-once (last) button, when it exists and
 * is enabled. ApprovalPanel renders reject (outline) before allow-once
 * (primary); after an answer the buttons disable and the panel unmounts, so
 * an enabled check is all that stands between us and a double-answer.
 */
function actionButton(panel: HTMLElement, edge: 'first' | 'last'): HTMLButtonElement | null {
  const buttons = panel.querySelectorAll('button')
  const button = buttons[edge === 'first' ? 0 : buttons.length - 1]
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
  const panel = findApprovalPanel(session)
  if (event.key === 'Enter') {
    const allowOnce = panel === null ? null : actionButton(panel, 'last')
    if (allowOnce === null) return 'none'
    allowOnce.click()
    return 'approve'
  }
  if (event.key === 'Escape') {
    if (panel !== null) {
      const reject = actionButton(panel, 'first')
      if (reject === null) return 'none'
      reject.click()
      return 'reject'
    }
    if (
      session !== undefined &&
      session.getSnapshot().running &&
      document.querySelector(DIALOG_SELECTOR) === null
    ) {
      // Pause: stop the running turn; pending queued work stays and resumes
      // in FIFO order once the host reaches cancellation quiescence.
      void session.cancel()
      return 'pause'
    }
  }
  return 'none'
}
