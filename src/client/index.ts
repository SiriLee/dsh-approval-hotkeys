/**
 * dsh-approval-hotkeys — browser half.
 *
 * Mounts one document-level `keydown` listener that implements the interaction
 * hotkeys (see `./hotkeys.ts` for the exact dispatch rules): Enter presses the
 * confirm (primary) button of any harness interaction panel — approval,
 * question/choice, plan review — and Esc presses its cancel button. No
 * settings, no commands, no host logic: the plugin is deliberately minimal.
 *
 * All side effects live inside a single `ctx.effect`, so plugin unload / HMR
 * tears the listener down. `export const inject = ['sessions']` is REQUIRED:
 * cordis refuses `ctx.sessions` access without it.
 *
 * The `uiSession` service — which carries the pending-interaction fact the
 * hotkeys target — is read lazily through `ctx.get` and deliberately NOT
 * declared: an inject naming a service the host lacks would keep this whole
 * client half unmounted, while `ctx.get` returning undefined leaves the DOM
 * fallback in charge.
 *
 * @module dsh-approval-hotkeys/client
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only merges: `ctx.sessions` (the catalog snapshot) and the `uiSession`
// service key. Without them every read below loses its check.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: the compile-time pins that keep the contract above from turning
// into `any` (see ./contract.ts).
import type {} from './contract.ts'
import { dispatch } from './hotkeys.ts'
import { resolveTarget, UNKNOWN_TARGET, type SessionsLike, type TargetResolution, type UiSessionLike } from './target.ts'

/** Stable plugin name. */
export const name = 'dsh-approval-hotkeys/client'

/** Required services: sessions (the catalog snapshot resolving the main view). */
export const inject = ['sessions']

/**
 * Mount the browser half: one document-level keydown listener, disposed with
 * the effect.
 * @param ctx - client root context carrying `sessions`.
 */
export function apply(ctx: Context): void {
  ctx.effect(function* () {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (dispatch(event, targetOf(ctx)) !== 'none') event.preventDefault()
    }
    document.addEventListener('keydown', onKeyDown)
    yield () => document.removeEventListener('keydown', onKeyDown)
  }, 'dsh-approval-hotkeys client lifecycle')
}

/**
 * What the runtime says about the conversation on screen, or `'unknown'` when
 * it cannot be read.
 *
 * Never throws: a harness that moved, renamed, or dropped one of these surfaces
 * must degrade the hotkeys to their DOM fallback, not break the keydown path.
 * The structural cast is the deliberate seam — the local interfaces describe
 * only the fields this plugin reads, so a richer service still satisfies them.
 */
function targetOf(ctx: Context): TargetResolution {
  try {
    // `ctx.get` (not `ctx.uiSession`): an undeclared service property access is
    // refused by cordis, while `get` returns undefined before registration.
    const uiSession = ctx.get('uiSession') as unknown as UiSessionLike | undefined
    return resolveTarget(uiSession, ctx.sessions as unknown as SessionsLike)
  } catch {
    return UNKNOWN_TARGET
  }
}
