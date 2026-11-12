import type { Editor } from '@tiptap/core'
import { countMarkedSpans, type MarkedNode } from '@genoffice/electron-utils/hiding-loss'
import { REDACT_MARK } from './ai/redact'

/** the hidden spans of the document, as a copy without hiding marks would lose them */
export function hiddenSpanCount(editor: Editor): number {
  return countMarkedSpans(editor.getJSON() as MarkedNode, REDACT_MARK)
}

/**
 * Before converting to a format with no hiding mark (ODT): with hidden spans
 * the person is asked once whether to go on; false = canceled, write nothing.
 */
export async function allowHidingLoss(editor: Editor): Promise<boolean> {
  const count = hiddenSpanCount(editor)
  return count === 0 || (await window.desktop.confirmHidingLoss(count)) === true
}
