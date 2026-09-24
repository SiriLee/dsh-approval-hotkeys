// @vitest-environment jsdom
/**
 * dsh-approval-hotkeys — keydown dispatch unit tests.
 *
 * jsdom provides a real DOM (real buttons, real click() calls, real event
 * targets); the target verdicts are plain values, so this suite pins the
 * dispatch rules without a ctx. The panel fixtures mirror the 0.1.7-rc.1
 * harness DOM as rendered by `dsh-client-ui-approval` and
 * `dsh-client-ui-user-questions`:
 *
 *   ApprovalPanel    root[data-approval-key] > card > [strip, body, actionRow]
 *                    actionRow = [Reject (outline), Allow once (primary)]
 *   QuestionComposer root[data-question-key] > section > [header, body, footer]
 *                    header = [minimize, cancel]; footer = [pager, feedback,
 *                    footerActions = [skip, submit]]
 *   PlanReviewPanel  root[data-plan-review-key] > section > [strip, summary, footer]
 *                    strip = [state, title, conversation.plan-review.actions slot]
 *                    footer = div[feedback, actions = [discuss, approve]]
 *
 * The plan-review footer is a `div`, NOT a `<footer>` tag — a regression here
 * once made both hotkeys silently dead on the plan panel while tests stayed
 * green on a tag-based fixture.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatch, findPanel } from '../src/client/hotkeys.ts'
import { UNKNOWN_TARGET, type TargetResolution } from '../src/client/target.ts'

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

/** The runtime verdict: this exact request awaits an answer here. */
function pending(kind: string, key: string): TargetResolution {
  return { state: 'pending', item: { kind, key } }
}

/** The runtime verdict: readable, nothing awaiting an answer. */
const IDLE: TargetResolution = { state: 'idle' }

/** Fixtures mount here unless a test supplies its own host. */
let host: HTMLElement

/** A wrapper that is present in the DOM but not answerable. */
function hiddenHost(): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.setAttribute('hidden', '')
  document.body.append(wrapper)
  return wrapper
}

/** A button marked as a non-hotkey tool control (the opt-out contract). */
function toolButton(label: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.textContent = label
  button.setAttribute('data-hotkey', 'none')
  return button
}

/** Approval panel fixture: card + action row, reject first, primary last. */
function makeApprovalPanel(key = 'approval:1', options: { toolButtons?: number; host?: HTMLElement } = {}): {
  root: HTMLElement
  reject: HTMLButtonElement
  allowOnce: HTMLButtonElement
  tools: HTMLButtonElement[]
} {
  const { toolButtons = 0 } = options
  const root = document.createElement('div')
  root.setAttribute('data-approval-key', key)
  const card = document.createElement('div')
  const body = document.createElement('div')
  body.setAttribute('data-approval-scroll', '')
  const actionRow = document.createElement('div')
  const reject = document.createElement('button')
  reject.textContent = 'Reject'
  const allowOnce = document.createElement('button')
  allowOnce.textContent = 'Allow once'
  const tools = Array.from({ length: toolButtons }, (_, index) => toolButton(`Tool ${String(index)}`))
  actionRow.append(...tools, reject, allowOnce)
  card.append(body, actionRow)
  root.append(card)
  ;(options.host ?? host).append(root)
  return { root, reject, allowOnce, tools }
}

/** Question composer fixture: header (minimize, cancel) + options + footer (pager, skip, submit). */
function makeQuestionPanel(key = 'question:1'): {
  root: HTMLElement
  minimize: HTMLButtonElement
  cancel: HTMLButtonElement
  prev: HTMLButtonElement
  next: HTMLButtonElement
  skip: HTMLButtonElement
  submit: HTMLButtonElement
  option: HTMLButtonElement
} {
  const root = document.createElement('div')
  root.setAttribute('data-question-key', key)
  const section = document.createElement('section')
  const header = document.createElement('header')
  const minimize = document.createElement('button')
  minimize.textContent = 'Minimize'
  const cancel = document.createElement('button')
  cancel.textContent = 'Cancel'
  header.append(minimize, cancel)
  const body = document.createElement('div')
  const options = document.createElement('div')
  const option = document.createElement('button')
  option.textContent = '1 Option'
  options.append(option)
  body.append(options)
  const footer = document.createElement('footer')
  const pager = document.createElement('div')
  const prev = document.createElement('button')
  prev.textContent = 'Previous'
  const next = document.createElement('button')
  next.textContent = 'Next'
  pager.append(prev, next)
  const footerActions = document.createElement('div')
  const skip = document.createElement('button')
  skip.textContent = 'Skip'
  const submit = document.createElement('button')
  submit.textContent = 'Submit'
  footerActions.append(skip, submit)
  footer.append(pager, footerActions)
  section.append(header, body, footer)
  root.append(section)
  host.append(root)
  return { root, minimize, cancel, prev, next, skip, submit, option }
}

/** Plan-review fixture: strip (state, title, action slot) + div footer (discuss, approve). */
function makePlanPanel(key = 'plan-review:1', options: { slotButtons?: number } = {}): {
  root: HTMLElement
  discuss: HTMLButtonElement
  approve: HTMLButtonElement
  slot: HTMLButtonElement[]
} {
  const { slotButtons = 0 } = options
  const root = document.createElement('div')
  root.setAttribute('data-plan-review-key', key)
  const section = document.createElement('section')
  const strip = document.createElement('div')
  const previewActions = document.createElement('div')
  const slot = Array.from({ length: slotButtons }, (_, index) => {
    const button = document.createElement('button')
    button.textContent = `Preview ${String(index)}`
    return button
  })
  previewActions.append(...slot)
  strip.append(previewActions)
  const footer = document.createElement('div')
  footer.className = 'planFooter'
  const actions = document.createElement('div')
  const discuss = document.createElement('button')
  discuss.textContent = 'Discuss'
  const approve = document.createElement('button')
  approve.textContent = 'Approve'
  actions.append(discuss, approve)
  footer.append(actions)
  section.append(strip, footer)
  root.append(section)
  host.append(root)
  return { root, discuss, approve, slot }
}

beforeEach(() => {
  document.body.innerHTML = ''
  host = document.body
})

describe('target verdict: pending (the awaiting request)', () => {
  it('approval: Enter clicks allow-once (last in the action row)', () => {
    const { allowOnce } = makeApprovalPanel()
    const spy = clickSpy(allowOnce)
    expect(dispatch(keyEvent('Enter', document.body), pending('approval', 'approval:1'))).toBe('confirm')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('approval: Esc clicks reject (first in the action row)', () => {
    const { reject } = makeApprovalPanel()
    const spy = clickSpy(reject)
    expect(dispatch(keyEvent('Escape', document.body), pending('approval', 'approval:1'))).toBe('cancel')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('question: Enter clicks submit (footer last)', () => {
    const { submit } = makeQuestionPanel()
    const spy = clickSpy(submit)
    expect(dispatch(keyEvent('Enter', document.body), pending('question', 'question:1'))).toBe('confirm')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('question: Esc clicks cancel (header last)', () => {
    const { cancel } = makeQuestionPanel()
    const spy = clickSpy(cancel)
    expect(dispatch(keyEvent('Escape', document.body), pending('question', 'question:1'))).toBe('cancel')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('plan review: Enter clicks approve (panel-wide last, past the action slot)', () => {
    const { approve } = makePlanPanel('plan-review:1', { slotButtons: 2 })
    const spy = clickSpy(approve)
    expect(dispatch(keyEvent('Enter', document.body), pending('plan-review', 'plan-review:1'))).toBe('confirm')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('plan review: Esc clicks discuss (panel-wide second last)', () => {
    const { discuss } = makePlanPanel('plan-review:1', { slotButtons: 2 })
    const spy = clickSpy(discuss)
    expect(dispatch(keyEvent('Escape', document.body), pending('plan-review', 'plan-review:1'))).toBe('cancel')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('locates the request by key, not by DOM order (a settled panel may stay behind)', () => {
    const stale = makeApprovalPanel('approval:1')
    const live = makeApprovalPanel('approval:2')
    const staleSpy = clickSpy(stale.allowOnce)
    const liveSpy = clickSpy(live.allowOnce)
    expect(dispatch(keyEvent('Enter', document.body), pending('approval', 'approval:2'))).toBe('confirm')
    expect(liveSpy).toHaveBeenCalledOnce()
    expect(staleSpy).not.toHaveBeenCalled()
  })

  it('does nothing when the awaiting request has no panel on screen', () => {
    const { allowOnce } = makeApprovalPanel('approval:1')
    const spy = clickSpy(allowOnce)
    expect(dispatch(keyEvent('Enter', document.body), pending('approval', 'approval:9'))).toBe('none')
    expect(spy).not.toHaveBeenCalled()
  })

  it('does nothing for an awaiting request in a domain this plugin does not render', () => {
    const { allowOnce } = makeApprovalPanel()
    const spy = clickSpy(allowOnce)
    expect(dispatch(keyEvent('Enter', document.body), pending('unknown-domain', 'approval:1'))).toBe('none')
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('target verdict: idle (readable, nothing awaiting an answer)', () => {
  it('leaves a lingering panel alone even though it is answerable', () => {
    const { allowOnce, reject } = makeApprovalPanel()
    const allowSpy = clickSpy(allowOnce)
    const rejectSpy = clickSpy(reject)
    expect(dispatch(keyEvent('Enter', document.body), IDLE)).toBe('none')
    expect(dispatch(keyEvent('Escape', document.body), IDLE)).toBe('none')
    expect(allowSpy).not.toHaveBeenCalled()
    expect(rejectSpy).not.toHaveBeenCalled()
  })
})

describe('target verdict: unknown (no runtime authority)', () => {
  it('falls back to the first answerable panel in DOM order', () => {
    const { allowOnce } = makeApprovalPanel()
    const spy = clickSpy(allowOnce)
    expect(dispatch(keyEvent('Enter', document.body), UNKNOWN_TARGET)).toBe('confirm')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('is the default verdict when the caller omits one', () => {
    const { allowOnce } = makeApprovalPanel()
    const spy = clickSpy(allowOnce)
    expect(dispatch(keyEvent('Enter', document.body))).toBe('confirm')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('prefers the approval panel over later kinds when several are present', () => {
    const approval = makeApprovalPanel()
    const question = makeQuestionPanel()
    const allowSpy = clickSpy(approval.allowOnce)
    const submitSpy = clickSpy(question.submit)
    expect(dispatch(keyEvent('Enter', document.body), UNKNOWN_TARGET)).toBe('confirm')
    expect(allowSpy).toHaveBeenCalledOnce()
    expect(submitSpy).not.toHaveBeenCalled()
  })
})

describe('answerable panels only', () => {
  it('skips a request whose panel sits in a hidden subtree', () => {
    makeApprovalPanel('approval:1', { host: hiddenHost() })
    expect(findPanel(pending('approval', 'approval:1'))).toBeNull()
    expect(dispatch(keyEvent('Enter', document.body), pending('approval', 'approval:1'))).toBe('none')
  })

  it('skips a request whose panel sits in an inert subtree', () => {
    const wrapper = document.createElement('div')
    wrapper.setAttribute('inert', '')
    document.body.append(wrapper)
    makeApprovalPanel('approval:1', { host: wrapper })
    expect(dispatch(keyEvent('Enter', document.body), pending('approval', 'approval:1'))).toBe('none')
  })

  it('skips a panel reported hidden through checkVisibility (visibility: hidden)', () => {
    const { root } = makeApprovalPanel()
    Object.defineProperty(root, 'checkVisibility', { value: () => false, configurable: true })
    expect(dispatch(keyEvent('Enter', document.body), pending('approval', 'approval:1'))).toBe('none')
  })

  it('falls through to the next answerable panel in the DOM fallback', () => {
    makeApprovalPanel('approval:1', { host: hiddenHost() })
    const live = makeApprovalPanel('approval:2')
    const spy = clickSpy(live.allowOnce)
    expect(dispatch(keyEvent('Enter', document.body), UNKNOWN_TARGET)).toBe('confirm')
    expect(spy).toHaveBeenCalledOnce()
  })
})

describe('guards', () => {
  it('ignores chorded Enter (Ctrl/Cmd+Enter is the composer queue shortcut)', () => {
    const { allowOnce } = makeApprovalPanel()
    const spy = clickSpy(allowOnce)
    expect(dispatch(keyEvent('Enter', document.body, { ctrlKey: true }), pending('approval', 'approval:1'))).toBe('none')
    expect(spy).not.toHaveBeenCalled()
  })

  it('ignores synthetic repeats', () => {
    const { allowOnce } = makeApprovalPanel()
    const spy = clickSpy(allowOnce)
    expect(dispatch(keyEvent('Enter', document.body, { repeat: true }), pending('approval', 'approval:1'))).toBe('none')
    expect(spy).not.toHaveBeenCalled()
  })

  it('ignores an IME composition Enter (a candidate pick is not an answer)', () => {
    const { allowOnce } = makeApprovalPanel()
    const spy = clickSpy(allowOnce)
    expect(dispatch(keyEvent('Enter', document.body, { isComposing: true }), pending('approval', 'approval:1'))).toBe('none')
    expect(spy).not.toHaveBeenCalled()
  })

  it('ignores the legacy keyCode 229 composition signal', () => {
    const { allowOnce } = makeApprovalPanel()
    const spy = clickSpy(allowOnce)
    const event = keyEvent('Enter', document.body)
    Object.defineProperty(event, 'keyCode', { value: 229 })
    expect(dispatch(event, pending('approval', 'approval:1'))).toBe('none')
    expect(spy).not.toHaveBeenCalled()
  })

  it('ignores Enter while typing in the composer editor even with a panel open', () => {
    const { allowOnce } = makeApprovalPanel()
    const spy = clickSpy(allowOnce)
    const editable = document.createElement('div')
    // jsdom implements neither the `contentEditable` reflection nor
    // `isContentEditable`, so the fixture sets the attribute React renders.
    editable.setAttribute('contenteditable', 'true')
    const textarea = document.createElement('textarea')
    const input = document.createElement('input')
    document.body.append(editable, textarea, input)
    for (const seat of [editable, textarea, input]) {
      expect(dispatch(keyEvent('Enter', seat), pending('approval', 'approval:1'))).toBe('none')
    }
    expect(spy).not.toHaveBeenCalled()
  })

  it('ignores Enter with focus on a button (native activation / the panel itself owns it)', () => {
    const { option } = makeQuestionPanel()
    const spy = clickSpy(option)
    expect(dispatch(keyEvent('Enter', option), pending('question', 'question:1'))).toBe('none')
    expect(spy).not.toHaveBeenCalled()
  })

  it('does nothing when the confirm button is disabled', () => {
    const { allowOnce } = makeApprovalPanel()
    allowOnce.disabled = true
    const spy = clickSpy(allowOnce)
    expect(dispatch(keyEvent('Enter', document.body), pending('approval', 'approval:1'))).toBe('none')
    expect(spy).not.toHaveBeenCalled()
  })

  it('does nothing when no panel is present', () => {
    expect(dispatch(keyEvent('Enter', document.body), UNKNOWN_TARGET)).toBe('none')
    expect(dispatch(keyEvent('Escape', document.body), UNKNOWN_TARGET)).toBe('none')
  })

  it('ignores any other key', () => {
    const { allowOnce } = makeApprovalPanel()
    const spy = clickSpy(allowOnce)
    expect(dispatch(keyEvent('a', document.body), pending('approval', 'approval:1'))).toBe('none')
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('button resolution contract', () => {
  it('skips opt-out tool buttons (data-hotkey="none") injected into the action row', () => {
    const { allowOnce, reject, tools } = makeApprovalPanel('approval:1', { toolButtons: 2 })
    const allowSpy = clickSpy(allowOnce)
    const toolSpy = clickSpy(tools[1] as HTMLButtonElement)
    expect(dispatch(keyEvent('Enter', document.body), pending('approval', 'approval:1'))).toBe('confirm')
    expect(allowSpy).toHaveBeenCalledOnce()
    expect(toolSpy).not.toHaveBeenCalled()
    const rejectSpy = clickSpy(reject)
    expect(dispatch(keyEvent('Escape', document.body), pending('approval', 'approval:1'))).toBe('cancel')
    expect(rejectSpy).toHaveBeenCalledOnce()
  })

  it('question minimized (footer unmounted): Enter does nothing, Esc still cancels', () => {
    const { root, cancel, submit } = makeQuestionPanel()
    root.querySelector('footer')?.remove()
    const submitSpy = clickSpy(submit)
    const cancelSpy = clickSpy(cancel)
    expect(dispatch(keyEvent('Enter', document.body), pending('question', 'question:1'))).toBe('none')
    expect(submitSpy).not.toHaveBeenCalled()
    expect(dispatch(keyEvent('Escape', document.body), pending('question', 'question:1'))).toBe('cancel')
    expect(cancelSpy).toHaveBeenCalledOnce()
  })

  it('does not double-fire when the confirm button itself has focus', () => {
    const { allowOnce } = makeApprovalPanel()
    const spy = clickSpy(allowOnce)
    expect(dispatch(keyEvent('Enter', allowOnce), pending('approval', 'approval:1'))).toBe('none')
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('findPanel', () => {
  it('reports the panel and its kind', () => {
    const { root } = makePlanPanel()
    const hit = findPanel(pending('plan-review', 'plan-review:1'))
    expect(hit?.element).toBe(root)
    expect(hit?.kind.pendingKind).toBe('plan-review')
  })

  it('is null when idle even though a panel is present', () => {
    makeApprovalPanel()
    expect(findPanel(IDLE)).toBeNull()
  })
})
