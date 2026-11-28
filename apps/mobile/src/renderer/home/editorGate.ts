// Asks before a file opens in an editor the user turned off (spec 3.10). App calls confirmEditorOn
// on every open path; the app layer registers the handler that asks [Turn on and open] / [Cancel].
import type { MobileClient } from '@genoffice/mobile-bridge/transport'
import type { EditorKind } from '../editors/editorKind'
import { ensureLoaded, isEditorOn } from './prefsStore'

/** Asks the user; resolves true to open (after turning the editor on), false to not open. */
export type EditorOffHandler = (kind: EditorKind) => Promise<boolean>

let handler: EditorOffHandler | null = null

/** Registers the asking handler (null removes it). The returned function removes this one. */
export function setEditorOffHandler(next: EditorOffHandler | null): () => void {
  handler = next
  return () => {
    if (handler === next) handler = null
  }
}

/**
 * Whether a file of `kind` may open. Waits for the first read of the settings (started with
 * `client` when given); with no client or a failed read every editor counts as on. An editor that
 * is off goes to the registered handler; with none registered the file opens. A handler that
 * fails keeps the file closed.
 */
export async function confirmEditorOn(kind: EditorKind, client?: MobileClient): Promise<boolean> {
  await ensureLoaded(client)
  if (isEditorOn(kind.id)) return true
  const ask = handler
  if (!ask) return true
  try {
    return await ask(kind)
  } catch {
    return false
  }
}
