/**
 * dsh-approval-hotkeys — compile-time pins on the DSH client contract.
 *
 * This module declares no runtime behavior. It exists because the client half
 * reads the harness through *structural* interfaces (so version drift degrades
 * instead of crashing), and a structural read is invisible to the type checker
 * once the imported type is gone: `skipLibCheck: true` turns an unresolved type
 * import into `any`, and `any` satisfies every read. A green typecheck would
 * then mean nothing — the trap the sister plugin `dsh-rewind` measured (dropping
 * its type-only peers collapsed four real errors into one).
 *
 * The assertions below fail to compile when a pinned shape drifts (renamed or
 * removed member) or degrades (`any`). They deliberately do NOT pin exact key
 * unions: the harness may add fields without breaking this plugin, and a pin
 * that fails on a benign addition would train its reader to ignore it.
 *
 * Called out of `src/client/index.ts` as a type-only import so it cannot become
 * orphaned, and compiled by `tsconfig.client.json` — i.e. by both `npm run
 * typecheck` and `npm run build`.
 *
 * @module dsh-approval-hotkeys/contract
 */

import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatus } from '@deepseek-ai/dsh-client-ui-session/client'

/** `true`/`false` literals, so an assertion's result is comparable. */
type Yes = true
type No = false
/** Whether `K` is one of `T`'s keys. */
type IsKey<K extends PropertyKey, T> = K extends keyof T ? Yes : No
/** Whether `T` degraded to `any` (which makes every check below vacuous). */
type IsAny<T> = 0 extends 1 & T ? Yes : No
/** Invariant type equality (distinguishes `any` from a concrete shape). */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? Yes : No
/** Compile error unless the argument is the literal `true`. */
type Expect<T extends Yes> = T

/** The catalog snapshot still carries the per-session rows the target read walks. */
export type SessionListStateIsConcrete = Expect<Equal<IsAny<SessionListState>, No>>
/** …and its rows still expose `byId`. */
export type SessionListStateHasById = Expect<Equal<IsKey<'byId', SessionListState>, Yes>>
/** Removal of `SessionListState.current` (0.1.6-alpha.2) is what forced this migration. */
export type SessionListStateHasNoCurrent = Expect<Equal<IsKey<'current', SessionListState>, No>>

/** A catalog row still carries local ownership counts. */
export type SessionSummaryIsConcrete = Expect<Equal<IsAny<SessionSummary>, No>>
/** `retainedBy.mainView` is the main-view signal that replaced `current`. */
export type SessionSummaryHasMainViewRetain = Expect<Equal<IsKey<'mainView', SessionSummary['retainedBy']>, Yes>>

/** The per-session UI status is the pending-interaction source on this line. */
export type SessionStatusIsConcrete = Expect<Equal<IsAny<SessionStatus>, No>>
/** …and still exposes the awaiting request. */
export type SessionStatusHasPendingInteraction = Expect<Equal<IsKey<'pendingInteraction', SessionStatus>, Yes>>
