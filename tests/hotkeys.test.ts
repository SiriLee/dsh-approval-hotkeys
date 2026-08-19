// @vitest-environment jsdom
/**
 * dsh-approval-hotkeys — keydown dispatch unit tests.
 *
 * jsdom provides a real DOM (real buttons, real click() calls, real event
 * targets); the session face is stubbed to the minimal surface the dispatch
 * reads (`getSnapshot().pending/running`, `cancel()`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionFace } from '@deepseek-ai/dsh-client-runtime/client'
import { dispatch, findApprovalPanel } from '../src/client/hotkeys.ts'

/** A keydown event whose target is pinned to `target` (jsdom cannot set it in the init dict). */
function keyEvent(key: string, target: EventTarget | null, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  Object.defineProperty(event, 'target', { value: target })
  return event
}

/** A bare approval panel with reject (first) + allow-once (last) buttons, appended to the DOM. */
function makePanel(key = 'approval:1'): {
  root: HTMLElement
  reject: HTMLButtonElement
  allowOnce: HTMLButtonElement
} {
  const root = document.createElement('div')
  root.setAttribute('data-approval-key', key)
  const reject = document.createElement('button')
  reject.textContent = 'Reject'
  const allowOnce = document.createElement('button')
  allowOnce.textContent = 'Allow once'
  root.append(reject, allowOnce)
  document.body.append(root)
  return { root, reject, allowOnce }
}

/** Spy on a button's click() so assertions survive jsdom (no `clicked` property). */
function clickSpy(button: HTMLButtonElement): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(button, 'click')
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

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('Enter → approve once', () => {
  it('clicks the allow-once button (last) and reports approve', () => {
    const { allowOnce } = makePanel()
    const spy = clickSpy(allowOnce)
    const session = sessionOf({ pending: [{ kind: 'approval', key: 'approval:1' }] })
    const action = dispatch(keyEvent('Enter', document.body), session)
    expect(action).toBe('approve')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('does nothing when the allow-once button is disabled (already answered)', () => {
    const { allowOnce } = makePanel()
    allowOnce.disabled = true
    const spy = clickSpy(allowOnce)
    const action = dispatch(keyEvent('Enter', document.body), sessionOf())
    expect(action).toBe('none')
    expect(spy).not.toHaveBeenCalled()
  })

  it('does nothing when no approval panel is present', () => {
    const action = dispatch(keyEvent('Enter', document.body), sessionOf())
    expect(action).toBe('none')
  })

  it('ignores Enter while typing in the composer textarea even with a panel open', () => {
    const { allowOnce } = makePanel()
    const spy = clickSpy(allowOnce)
    const textarea = document.createElement('textarea')
    document.body.append(textarea)
    const action = dispatch(keyEvent('Enter', textarea), sessionOf())
    expect(action).toBe('none')
    expect(spy).not.toHaveBeenCalled()
  })

  it('ignores chorded Enter (Ctrl/Cmd+Enter is the composer queue shortcut)', () => {
    const { allowOnce } = makePanel()
    const spy = clickSpy(allowOnce)
    const action = dispatch(keyEvent('Enter', document.body, { ctrlKey: true }), sessionOf())
    expect(action).toBe('none')
    expect(spy).not.toHaveBeenCalled()
  })

  it('ignores synthetic repeats', () => {
    const { allowOnce } = makePanel()
    const spy = clickSpy(allowOnce)
    const action = dispatch(keyEvent('Enter', document.body, { repeat: true }), sessionOf())
    expect(action).toBe('none')
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('Esc → reject', () => {
  it('clicks the reject button (first) and reports reject', () => {
    const { reject } = makePanel()
    const spy = clickSpy(reject)
    const session = sessionOf({ pending: [{ kind: 'approval', key: 'approval:1' }] })
    const action = dispatch(keyEvent('Escape', document.body), session)
    expect(action).toBe('reject')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('does nothing when the reject button is disabled', () => {
    const { reject } = makePanel()
    reject.disabled = true
    const spy = clickSpy(reject)
    const action = dispatch(keyEvent('Escape', document.body), sessionOf())
    expect(action).toBe('none')
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('Esc → pause', () => {
  it('cancels the running turn when no panel is present and the agent runs', () => {
    const session = sessionOf({ running: true })
    const action = dispatch(keyEvent('Escape', document.body), session)
    expect(action).toBe('pause')
    expect(cancelSpy(session)).toHaveBeenCalledOnce()
  })

  it('does nothing when the agent is idle', () => {
    const session = sessionOf({ running: false })
    const action = dispatch(keyEvent('Escape', document.body), session)
    expect(action).toBe('none')
    expect(cancelSpy(session)).not.toHaveBeenCalled()
  })

  it('does nothing with no session selected', () => {
    const action = dispatch(keyEvent('Escape', document.body), undefined)
    expect(action).toBe('none')
  })

  it('does not pause while a modal dialog is open (Esc belongs to the dialog)', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.append(dialog)
    const session = sessionOf({ running: true })
    const action = dispatch(keyEvent('Escape', document.body), session)
    expect(action).toBe('none')
    expect(cancelSpy(session)).not.toHaveBeenCalled()
  })

  it('prefers reject over pause when both a panel and a running agent exist', () => {
    const { reject } = makePanel()
    const spy = clickSpy(reject)
    const session = sessionOf({ running: true, pending: [{ kind: 'approval', key: 'approval:1' }] })
    const action = dispatch(keyEvent('Escape', document.body), session)
    expect(action).toBe('reject')
    expect(spy).toHaveBeenCalledOnce()
    expect(cancelSpy(session)).not.toHaveBeenCalled()
  })
})

describe('panel resolution', () => {
  it('prefers the current session’s pending approval key over an earlier panel in DOM order', () => {
    const first = makePanel('approval:other')
    const second = makePanel('approval:2')
    const firstSpy = clickSpy(first.allowOnce)
    const secondSpy = clickSpy(second.allowOnce)
    const session = sessionOf({ pending: [{ kind: 'approval', key: 'approval:2' }] })
    expect(findApprovalPanel(session)).toBe(second.root)
    const action = dispatch(keyEvent('Enter', document.body), session)
    expect(action).toBe('approve')
    expect(firstSpy).not.toHaveBeenCalled()
    expect(secondSpy).toHaveBeenCalledOnce()
  })

  it('falls back to the first panel in DOM order when the session has no approval pending', () => {
    const first = makePanel('approval:a')
    makePanel('approval:b')
    const spy = clickSpy(first.reject)
    const session = sessionOf({ running: true })
    expect(findApprovalPanel(session)).toBe(first.root)
    const action = dispatch(keyEvent('Escape', document.body), session)
    expect(action).toBe('reject')
    expect(spy).toHaveBeenCalledOnce()
  })
})
