/**
 * dsh-approval-hotkeys — target resolution tests.
 *
 * Pure values, no DOM: the two runtime surfaces are stubbed to the shape the
 * plugin reads, including the shapes a harness generation *without* them
 * presents (absent service, renamed snapshot field). The three verdicts are
 * load-bearing for an approval UI, so each is pinned separately: a request that
 * is not the conversation on screen must resolve to `idle` (never a positional
 * guess), while an unreadable surface must resolve to `unknown` (the DOM
 * fallback) rather than a false `idle` that would silently kill the hotkeys.
 */
import { describe, expect, it } from 'vitest'
import { resolveTarget, type SessionsLike, type UiSessionLike } from '../src/client/target.ts'

/** A `uiSession` stub whose status map carries the given entries. */
function uiSession(entries: readonly (readonly [string, { pendingInteraction?: { kind: string; key: string } }])[]): UiSessionLike {
  return { sessionStatus: { getSnapshot: () => new Map(entries) } }
}

/** A `sessions` stub whose catalog rows carry the given main-view counts. */
function sessions(rows: Readonly<Record<string, number>>): SessionsLike {
  const byId = Object.fromEntries(
    Object.entries(rows).map(([id, mainView]) => [id, { retainedBy: { mainView } }]),
  )
  return { list: { getSnapshot: () => ({ byId }) } }
}

describe('resolveTarget', () => {
  it('reports the pending request of the main-view session', () => {
    const target = resolveTarget(
      uiSession([['session_a', { pendingInteraction: { kind: 'approval', key: 'approval:1' } }]]),
      sessions({ session_a: 1 }),
    )
    expect(target).toEqual({ state: 'pending', item: { kind: 'approval', key: 'approval:1' } })
  })

  it('skips the main-view session when it has nothing awaiting an answer', () => {
    const target = resolveTarget(
      uiSession([
        ['session_a', {}],
        ['session_b', { pendingInteraction: { kind: 'approval', key: 'approval:2' } }],
      ]),
      sessions({ session_a: 1, session_b: 0 }),
    )
    expect(target).toEqual({ state: 'idle' })
  })

  it('picks the main-view session, not the first pending one in map order', () => {
    const target = resolveTarget(
      uiSession([
        ['background', { pendingInteraction: { kind: 'approval', key: 'approval:1' } }],
        ['viewed', { pendingInteraction: { kind: 'question', key: 'question:7' } }],
      ]),
      sessions({ background: 0, viewed: 2 }),
    )
    expect(target).toEqual({ state: 'pending', item: { kind: 'question', key: 'question:7' } })
  })

  it('reports idle when no session has a pending interaction', () => {
    const target = resolveTarget(uiSession([['session_a', {}], ['session_b', {}]]), sessions({ session_a: 1 }))
    expect(target).toEqual({ state: 'idle' })
  })

  it('is unknown without the uiSession service', () => {
    expect(resolveTarget(undefined, sessions({ session_a: 1 }))).toEqual({ state: 'unknown' })
  })

  it('is unknown without the sessions service', () => {
    expect(resolveTarget(uiSession([['session_a', {}]]), undefined)).toEqual({ state: 'unknown' })
  })

  it('is unknown when the status surface is gone (a generation without it)', () => {
    expect(resolveTarget({}, sessions({ session_a: 1 }))).toEqual({ state: 'unknown' })
  })

  it('is unknown when the catalog snapshot no longer exposes byId', () => {
    const renamed: SessionsLike = { list: { getSnapshot: () => ({}) } }
    expect(
      resolveTarget(uiSession([['session_a', { pendingInteraction: { kind: 'approval', key: 'approval:1' } }]]), renamed),
    ).toEqual({ state: 'unknown' })
  })

  it('tolerates a status map whose entries are absent or malformed', () => {
    const sparse = {
      sessionStatus: { getSnapshot: () => new Map([['session_a', undefined]]) },
    } as unknown as UiSessionLike
    expect(resolveTarget(sparse, sessions({ session_a: 1 }))).toEqual({ state: 'idle' })
  })

  it('tolerates a row missing its retain counts', () => {
    const sparse: SessionsLike = { list: { getSnapshot: () => ({ byId: { session_a: {} } }) } }
    expect(
      resolveTarget(uiSession([['session_a', { pendingInteraction: { kind: 'approval', key: 'approval:1' } }]]), sparse),
    ).toEqual({ state: 'idle' })
  })
})
