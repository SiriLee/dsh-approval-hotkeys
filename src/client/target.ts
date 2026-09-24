/**
 * dsh-approval-hotkeys — target resolution (which pending interaction may be
 * answered by a hotkey).
 *
 * Pure: no ctx, no DOM, no harness imports. The client entry wires in the two
 * observable surfaces this reads:
 *
 *   `uiSession.sessionStatus` — the harness's per-session UI status, whose
 *   `pendingInteraction` is the highest-precedence request awaiting an answer.
 *   It replaced the `uiSession.pendingInteractions` map removed in 0.1.7-rc.1.
 *
 *   `sessions.list` — the catalog snapshot. `retainedBy.mainView > 0` marks the
 *   session the main view retains: the sanctioned replacement for the
 *   `SessionListState.current` field deleted in 0.1.6-alpha.2, and the same
 *   expression `ui-session` itself uses to decide its main binding.
 *
 * Both are typed structurally on purpose — the plugin must survive harness
 * version drift, so it never imports the owning packages' types and every read
 * is optional-chained. A surface that moved, vanished, or arrived late
 * resolves to `'unknown'` (the caller then falls back to the DOM), never throws.
 *
 * The three outcomes matter because they are not interchangeable for an
 * approval UI: answering the wrong request is worse than a dead shortcut, so a
 * readable status surface that reports nothing awaiting an answer is treated as
 * authoritative (`'idle'`), while only an *unreadable* surface degrades to the
 * position-based DOM heuristic.
 *
 * @module dsh-approval-hotkeys/target
 */

/** One pending interaction awaiting an answer: what a hotkey may act on. */
export interface PendingItem {
  /** Domain discriminator: `'approval'`, `'question'`, or `'plan-review'`. */
  readonly kind: string
  /** Request identity, i.e. the panel's `data-*-key` anchor value. */
  readonly key: string
}

/**
 * What the runtime says about the conversation on screen.
 *
 * - `'pending'` — this exact request is awaiting an answer here.
 * - `'idle'` — the runtime was readable and reports nothing awaiting an answer;
 *   the hotkeys must stay out of the way (a panel left in the DOM belongs to a
 *   request that is not this conversation's, or is already settled).
 * - `'unknown'` — the runtime surface is absent or unreadable; the caller falls
 *   back to the first answerable panel in DOM order.
 */
export type TargetResolution =
  | { readonly state: 'pending'; readonly item: PendingItem }
  | { readonly state: 'idle' }
  | { readonly state: 'unknown' }

/** The shared `'unknown'` resolution (no runtime authority). */
export const UNKNOWN_TARGET: TargetResolution = { state: 'unknown' }

/** One row's local ownership counts, as far as this plugin reads them. */
interface RetainCountsLike {
  readonly mainView?: number | undefined
}

/** One catalog row as far as this plugin reads it. */
interface SessionRowLike {
  readonly retainedBy?: RetainCountsLike | undefined
}

/** One session's UI status as far as this plugin reads it. */
interface SessionStatusLike {
  readonly pendingInteraction?: PendingItem | undefined
}

/**
 * Structural face of the `uiSession` service. Only `sessionStatus` is read; the
 * field is optional so a harness generation without it resolves to `'unknown'`
 * instead of throwing on property access.
 */
export interface UiSessionLike {
  readonly sessionStatus?:
    | { getSnapshot(): ReadonlyMap<string, SessionStatusLike | undefined> }
    | undefined
}

/**
 * Structural face of the `sessions` service. Only the list snapshot is read,
 * and only its `byId` rows.
 */
export interface SessionsLike {
  readonly list?:
    | {
        getSnapshot(): {
          readonly byId?: Readonly<Record<string, SessionRowLike | undefined>> | undefined
        }
      }
    | undefined
}

/**
 * Resolve what the hotkeys may answer for the session the main view retains.
 *
 * @param uiSession - the `uiSession` service, or undefined before it registers.
 * @param sessions - the `sessions` service, or undefined before it registers.
 * @returns the runtime's verdict for the conversation on screen.
 */
export function resolveTarget(
  uiSession: UiSessionLike | undefined,
  sessions: SessionsLike | undefined,
): TargetResolution {
  const statuses = uiSession?.sessionStatus?.getSnapshot()
  if (statuses === undefined) return UNKNOWN_TARGET
  const rows = sessions?.list?.getSnapshot().byId
  // Without the ownership counts the main view cannot be identified: degrade to
  // the DOM heuristic instead of reporting a false "nothing to answer".
  if (rows === undefined) return UNKNOWN_TARGET
  for (const [sessionId, status] of statuses) {
    const pending = status?.pendingInteraction
    if (pending === undefined) continue
    if ((rows[sessionId]?.retainedBy?.mainView ?? 0) > 0) {
      return { state: 'pending', item: { kind: pending.kind, key: pending.key } }
    }
  }
  return { state: 'idle' }
}
