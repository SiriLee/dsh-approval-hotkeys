/**
 * dsh-approval-hotkeys — host loader entry.
 *
 * This plugin is browser-only: every behavior (Enter approve, Esc reject /
 * Esc pause) lives in the client half (`src/client`, shipped as
 * `exports["./client"]` and loaded by the harness web app). The host entry
 * is a no-op stub so the package still loads through the dsh CLI's cordis
 * loader exactly like a dual-face plugin.
 *
 * @module dsh-approval-hotkeys
 */

/** Provides no host-side behavior. */
export function apply(): void {}
