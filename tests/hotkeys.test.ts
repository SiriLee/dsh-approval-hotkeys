// @vitest-environment jsdom
/**
 * dsh-approval-hotkeys — keydown dispatch unit tests.
 *
 * jsdom provides a real DOM (real buttons, real click() calls, real event
 * targets); the session face is stubbed to the minimal surface the dispatch
 * reads (`getSnapshot().pending`, `cancel()`). The panel fixtures
 * mirror the harness layout contract: the confirm (primary) button is the
 * last button of its row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionFace } from '@deepseek-ai/dsh-client-runtime/client'
import { dispatch, findPanel, type UiSessionLike } from '../src/client/hotkeys.ts'

/** A keydown event whose target is pinned to `target` (jsdom cannot set it in the init dict). */
function keyEvent(key: string, target: EventTarget | null, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  Object.defineProperty(event, 'target', { value: target })
  return event
}

/** Spy on a button's click() so assertions survive jsdom (no `clicked` property). */
function clickSpy(button: HTMLButtonElement): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(button, 'click')
}

/** Approval panel fixture: [Reject] [Allow once] — reject first, primary last.
 * With `withCollapse`, a `data-hotkey="none"` utility button (e.g. a diff
 * collapse toggle) is injected ahead of the action row, mirroring the
 * dsh-edit-approval contract. */
function makeApprovalPanel(
  key = 'approval:1',
  withCollapse = false,
): {
  root: HTMLElement
  reject: HTMLButtonElement
  allowOnce: HTMLButtonElement
  collapse?: HTMLButtonElement
} {
  const root = document.createElement('div')
  root.setAttribute('data-approval-key', key)
  const collapse = withCollapse ? document.createElement('button') : undefined
  if (collapse !== undefined) {
    collapse.textContent = 'Collapse'
    collapse.setAttribute('data-hotkey', 'none')
  }
  const reject = document.createElement('button')
  reject.textContent = 'Reject'
  const allowOnce = document.createElement('button')
  allowOnce.textContent = 'Allow once'
  if (collapse !== undefined) root.append(collapse)
  root.append(reject, allowOnce)
  document.body.append(root)
  return { root, reject, allowOnce, collapse }
}

/** Question composer fixture: header (minimize, discard) + footer (skip, submit). */
function makeQuestionPanel(key = 'question:1'): {
  root: HTMLElement
  minimize: HTMLButtonElement
  discard: HTMLButtonElement
  skip: HTMLButtonElement
  submit: HTMLButtonElement
} {
  const root = document.createElement('div')
  root.setAttribute('data-question-key', key)
  const header = document.createElement('header')
  const minimize = document.createElement('button')
  minimize.textContent = 'Minimize'
  const discard = document.createElement('button')
  discard.textContent = 'Discard'
  header.append(minimize, discard)
  const footer = document.createElement('footer')
  const skip = document.createElement('button')
  skip.textContent = 'Skip'
  const submit = document.createElement('button')
  submit.textContent = 'Submit'
  footer.append(skip, submit)
  root.append(header, footer)
  document.body.append(root)
  return { root, minimize, discard, skip, submit }
}

/**
 * Plan review fixture. Mirrors the REAL harness DOM: PlanReviewPanel renders
 * its actions inside a plain `<div className="…footer">`, NOT a `<footer>`
 * tag (a regression here once made both hotkeys silently dead on the plan
 * panel while tests stayed green on the tag-based fixture).
 */
function makePlanPanel(key = 'plan-review:1', withDecline = true): {
  root: HTMLElement
  discuss: HTMLButtonElement
  decline?: HTMLButtonElement
  approve: HTMLButtonElement
} {
  const root = document.createElement('div')
  root.setAttribute('data-plan-review-key', key)
  const footer = document.createElement('div')
  footer.className = 'planFooter'
  const discuss = document.createElement('button')
  discuss.textContent = 'Discuss'
  footer.append(discuss)
  const decline = withDecline ? document.createElement('button') : undefined
  if (decline !== undefined) {
    decline.textContent = 'Decline'
    footer.append(decline)
  }
  const approve = document.createElement('button')
  approve.textContent = 'Approve'
  footer.append(approve)
  root.append(footer)
  document.body.append(root)
  return { root, discuss, decline, approve }
}

interface PendingLike {
  kind: string
  key: string
}

/** Minimal session face stub: pending list, running bit, cancel spy. */
function sessionOf(options: { running?: boolean; pending?: readonly PendingLike[] } = {}): SessionFace {
  const { running = false, pending = [] } = options
  const session = {
    getSnapshot: () => ({ running, pending }),
    cancel: vi.fn(async () => ({ ok: true })),
  }
  return session as unknown as SessionFace
}

function cancelSpy(session: SessionFace): ReturnType<typeof vi.fn> {
  return (session as unknown as { cancel: ReturnType<typeof vi.fn> }).cancel
}

/** Alpha.1+ session face: `getSnapshot()` no longer carries `pending` (it moved to the ui-session pending map). */
function alpha2Session(): SessionFace {
  return {
    getSnapshot: () => ({ running: false }),
    cancel: vi.fn(async () => ({ ok: true })),
  } as unknown as SessionFace
}

/** Alpha.1+ ui-session pending map fixture (per-session pending interaction). */
function alpha2UiSession(entries: Record<string, { kind: string; key: string }>): UiSessionLike {
  return { pendingInteractions: { getSnapshot: () => new Map(Object.entries(entries)) } }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('Enter → confirm (the primary button)', () => {
  it('approval panel: clicks the allow-once button (last) and reports confirm', () => {
    const { allowOnce } = makeApprovalPanel()
    const spy = clickSpy(allowOnce)
    const session = sessionOf({ pending: [{ kind: 'approval', key: 'approval:1' }] })
    const action = dispatch(keyEvent('Enter', document.body), session)
    expect(action).toBe('confirm')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('question panel: clicks the submit button (footer last) and reports confirm', () => {
    const { submit } = makeQuestionPanel()
    const spy = clickSpy(submit)
    const session = sessionOf({ pending: [{ kind: 'question', key: 'question:1' }] })
    const action = dispatch(keyEvent('Enter', document.body), session)
    expect(action).toBe('confirm')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('plan review: clicks the approve button (footer last) and reports confirm', () => {
    const { approve } = makePlanPanel()
    const spy = clickSpy(approve)
    const action = dispatch(keyEvent('Enter', document.body), sessionOf())
    expect(action).toBe('confirm')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('does nothing when the confirm button is disabled', () => {
    const { allowOnce } = makeApprovalPanel()
    allowOnce.disabled = true
    const spy = clickSpy(allowOnce)
    const action = dispatch(keyEvent('Enter', document.body), sessionOf())
    expect(action).toBe('none')
    expect(spy).not.toHaveBeenCalled()
  })

  it('does nothing when no panel is present', () => {
    const action = dispatch(keyEvent('Enter', document.body), sessionOf())
    expect(action).toBe('none')
  })

  it('does nothing when focus sits on a button (native activation / built-in Enter owns it)', () => {
    const { reject } = makeApprovalPanel()
    const rejectSpy = clickSpy(reject)
    const { allowOnce } = makeApprovalPanel('approval:2')
    const allowOnceSpy = clickSpy(allowOnce)
    // Focus on the question option-like button: Enter must not double-fire.
    const option = document.createElement('button')
    document.body.append(option)
    const action = dispatch(keyEvent('Enter', option), sessionOf())
    expect(action).toBe('none')
    expect(rejectSpy).not.toHaveBeenCalled()
    expect(allowOnceSpy).not.toHaveBeenCalled()
  })

  it('ignores Enter while typing in the composer textarea even with a panel open', () => {
    const { allowOnce } = makeApprovalPanel()
    const spy = clickSpy(allowOnce)
    const textarea = document.createElement('textarea')
    document.body.append(textarea)
    const action = dispatch(keyEvent('Enter', textarea), sessionOf())
    expect(action).toBe('none')
    expect(spy).not.toHaveBeenCalled()
  })

  it('ignores chorded Enter (Ctrl/Cmd+Enter is the composer queue shortcut)', () => {
    const { allowOnce } = makeApprovalPanel()
    const spy = clickSpy(allowOnce)
    const action = dispatch(keyEvent('Enter', document.body, { ctrlKey: true }), sessionOf())
    expect(action).toBe('none')
    expect(spy).not.toHaveBeenCalled()
  })

  it('ignores synthetic repeats', () => {
    const { allowOnce } = makeApprovalPanel()
    const spy = clickSpy(allowOnce)
    const action = dispatch(keyEvent('Enter', document.body, { repeat: true }), sessionOf())
    expect(action).toBe('none')
    expect(spy).not.toHaveBeenCalled()
  })

  it('question panel minimized: no footer → no confirm button → nothing happens', () => {
    const { root, discard } = makeQuestionPanel()
    // Simulate the minimized state: footer unmounted, header remains.
    root.querySelector('footer')?.remove()
    const discardSpy = clickSpy(discard)
    const action = dispatch(keyEvent('Enter', document.body), sessionOf())
    expect(action).toBe('none')
    expect(discardSpy).not.toHaveBeenCalled()
  })
})

describe('Esc → cancel', () => {
  it('approval panel: clicks the reject button (first) and reports cancel', () => {
    const { reject } = makeApprovalPanel()
    const spy = clickSpy(reject)
    const session = sessionOf({ pending: [{ kind: 'approval', key: 'approval:1' }] })
    const action = dispatch(keyEvent('Escape', document.body), session)
    expect(action).toBe('cancel')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('question panel: clicks the discard button (header last) and reports cancel', () => {
    const { discard } = makeQuestionPanel()
    const spy = clickSpy(discard)
    const session = sessionOf({ pending: [{ kind: 'question', key: 'question:1' }] })
    const action = dispatch(keyEvent('Escape', document.body), session)
    expect(action).toBe('cancel')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('plan review: clicks the decline button (footer second-last) and reports cancel', () => {
    const { decline } = makePlanPanel()
    const spy = clickSpy(decline!)
    const action = dispatch(keyEvent('Escape', document.body), sessionOf())
    expect(action).toBe('cancel')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('plan review without a decline action: falls back to discuss (footer second-last)', () => {
    const { discuss } = makePlanPanel('plan-review:2', false)
    const spy = clickSpy(discuss)
    const action = dispatch(keyEvent('Escape', document.body), sessionOf())
    expect(action).toBe('cancel')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('does nothing when the cancel button is disabled', () => {
    const { reject } = makeApprovalPanel()
    reject.disabled = true
    const spy = clickSpy(reject)
    const action = dispatch(keyEvent('Escape', document.body), sessionOf())
    expect(action).toBe('none')
    expect(spy).not.toHaveBeenCalled()
  })

  it('does nothing when no panel is present, even while the agent runs (no pause feature)', () => {
    const session = sessionOf({ running: true })
    const action = dispatch(keyEvent('Escape', document.body), session)
    expect(action).toBe('none')
    expect(cancelSpy(session)).not.toHaveBeenCalled()
  })

  it('does nothing while typing in the composer textarea even with a panel open', () => {
    const { reject } = makeApprovalPanel()
    const spy = clickSpy(reject)
    const textarea = document.createElement('textarea')
    document.body.append(textarea)
    const action = dispatch(keyEvent('Escape', textarea), sessionOf())
    expect(action).toBe('none')
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('panel resolution', () => {
  it('prefers the current session’s pending approval key over an earlier panel in DOM order', () => {
    const first = makeApprovalPanel('approval:other')
    const second = makeApprovalPanel('approval:2')
    const firstSpy = clickSpy(first.allowOnce)
    const secondSpy = clickSpy(second.allowOnce)
    const session = sessionOf({ pending: [{ kind: 'approval', key: 'approval:2' }] })
    expect(findPanel(session)?.element).toBe(second.root)
    const action = dispatch(keyEvent('Enter', document.body), session)
    expect(action).toBe('confirm')
    expect(firstSpy).not.toHaveBeenCalled()
    expect(secondSpy).toHaveBeenCalledOnce()
  })

  it('prefers the current session’s pending question key over another panel kind in DOM order', () => {
    const approval = makeApprovalPanel('approval:a')
    const question = makeQuestionPanel('question:7')
    const approvalSpy = clickSpy(approval.allowOnce)
    const questionSpy = clickSpy(question.submit)
    const session = sessionOf({ pending: [{ kind: 'question', key: 'question:7' }] })
    expect(findPanel(session)?.element).toBe(question.root)
    const action = dispatch(keyEvent('Enter', document.body), session)
    expect(action).toBe('confirm')
    expect(approvalSpy).not.toHaveBeenCalled()
    expect(questionSpy).toHaveBeenCalledOnce()
  })

  it('falls back to the first panel in DOM order when the session has no matching pending', () => {
    const first = makeApprovalPanel('approval:a')
    makeQuestionPanel('question:b')
    const spy = clickSpy(first.reject)
    const session = sessionOf({ running: true })
    expect(findPanel(session)?.element).toBe(first.root)
    const action = dispatch(keyEvent('Escape', document.body), session)
    expect(action).toBe('cancel')
    expect(spy).toHaveBeenCalledOnce()
  })
})

describe('data-hotkey="none" opt-out buttons', () => {
  it('Esc clicks Reject, not the leading utility button', () => {
    const { reject, collapse } = makeApprovalPanel('approval:1', true)
    const rejectSpy = clickSpy(reject)
    const collapseSpy = clickSpy(collapse!)
    const session = sessionOf({ pending: [{ kind: 'approval', key: 'approval:1' }] })
    const action = dispatch(keyEvent('Escape', document.body), session)
    expect(action).toBe('cancel')
    expect(rejectSpy).toHaveBeenCalledOnce()
    expect(collapseSpy).not.toHaveBeenCalled()
  })

  it('Enter clicks Allow once, not the leading utility button', () => {
    const { allowOnce, collapse } = makeApprovalPanel('approval:1', true)
    const allowOnceSpy = clickSpy(allowOnce)
    const collapseSpy = clickSpy(collapse!)
    const session = sessionOf({ pending: [{ kind: 'approval', key: 'approval:1' }] })
    const action = dispatch(keyEvent('Enter', document.body), session)
    expect(action).toBe('confirm')
    expect(allowOnceSpy).toHaveBeenCalledOnce()
    expect(collapseSpy).not.toHaveBeenCalled()
  })
})

describe('alpha.1+ ui-session pending channel (0.1.2-alpha.x)', () => {
  it('resolves the pending approval key from the ui-session map when the session face no longer carries `pending`', () => {
    const first = makeApprovalPanel('approval:other')
    const second = makeApprovalPanel('approval:alpha')
    const firstSpy = clickSpy(first.allowOnce)
    const secondSpy = clickSpy(second.allowOnce)
    const session = alpha2Session()
    const uiSession = alpha2UiSession({ 'sess-1': { kind: 'approval', key: 'approval:alpha' } })
    expect(findPanel(session, 'sess-1', uiSession)?.element).toBe(second.root)
    const action = dispatch(keyEvent('Enter', document.body), session, 'sess-1', uiSession)
    expect(action).toBe('confirm')
    expect(firstSpy).not.toHaveBeenCalled()
    expect(secondSpy).toHaveBeenCalledOnce()
  })

  it('degrades to the DOM fallback when the ui-session channel resolves no pending for the current session', () => {
    const { reject } = makeApprovalPanel('approval:x')
    const spy = clickSpy(reject)
    const session = alpha2Session()
    const uiSession = alpha2UiSession({})
    const action = dispatch(keyEvent('Escape', document.body), session, 'sess-1', uiSession)
    expect(action).toBe('cancel')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('never throws when the session face has no `pending` and no ui-session service is present', () => {
    const { reject } = makeApprovalPanel('approval:x')
    const spy = clickSpy(reject)
    const action = dispatch(keyEvent('Escape', document.body), alpha2Session(), 'sess-1', undefined)
    expect(action).toBe('cancel')
    expect(spy).toHaveBeenCalledOnce()
  })
})
