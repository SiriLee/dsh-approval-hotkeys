/**
 * dsh-approval-hotkeys — browser half.
 *
 * Mounts one document-level `keydown` listener that implements the
 * interaction hotkeys (see `./hotkeys.ts` for the exact dispatch rules):
 * Enter presses the confirm (primary) button of any harness interaction
 * panel — approval, question/choice, plan review — and Esc presses its
 * cancel button. No settings, no commands, no host logic: the plugin is
 * deliberately minimal.
 *
 * All side effects live inside a single `ctx.effect`, so plugin unload / HMR
 * tears the listener down. `export const inject = ['sessions']` is REQUIRED:
 * without it `ctx.sessions` is not ready and the client half fails silently
 * (a pitfall hit and documented in dsh-edit-approval).
 *
 * @module dsh-approval-hotkeys/client
 */

// Type-only: module-table word, never inlined; the runtime code below only
// touches the DOM and the session face.
import type { ClientContext, SessionFace } from '@deepseek-ai/dsh-client-runtime/client'
import { dispatch, type UiSessionLike } from './hotkeys.ts'

/** Stable plugin name. */
export const name = 'dsh-approval-hotkeys/client'

/** Required services: sessions (current session face, pending approvals). */
export const inject = ['sessions']

/**
 * Mount the browser half: one document-level keydown listener, disposed with
 * the effect.
 * @param ctx - client root context carrying `sessions`.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(function* () {
    const onKeyDown = (event: KeyboardEvent): void => {
      const id = ctx.sessions.list.getSnapshot().current
      const session = id === undefined ? undefined : ctx.sessions.binding(id)?.session
      // Alpha.1+ ui-session service: resolved lazily, never a declared inject
      // (the name does not exist on harness rc.2). The rc.2 channel reads the
      // session face directly instead (dual-channel pending, see hotkeys.ts).
      const uiSession = ctx.get('uiSession') as UiSessionLike | undefined
      if (dispatch(event, session, id, uiSession) !== 'none') event.preventDefault()
    }
    document.addEventListener('keydown', onKeyDown)
    yield () => document.removeEventListener('keydown', onKeyDown)
  }, 'dsh-approval-hotkeys client lifecycle')
}
