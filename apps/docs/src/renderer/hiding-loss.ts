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

/** A save of an ODT document that the person declined because it would drop hidden spans. */
export class HidingLossDeclined extends Error {
  constructor() {
    super('not saved: ODT cannot keep the hidden spans, and dropping them was declined')
    this.name = 'HidingLossDeclined'
  }
}

/** the document and hidden-span count the person already agreed to lose on an ODT save */
let odtSaveAgreed: { document: unknown; count: number } | null = null

/**
 * Before a normal save of an ODT document: ODT has no hiding mark, so writing
 * it drops every hidden span. With hidden spans the person is asked; after
 * "go on" the same document is not asked again until it holds more of them.
 * An automatic save never asks: it waits (false) until a save the person
 * made has the answer. A document without hidden spans saves as before.
 *
 * `document` tells documents apart (the tab's document generation).
 */
export async function allowOdtSaveHidingLoss(
  editor: Editor,
  document: unknown,
  auto: boolean,
): Promise<boolean> {
  const type = editor.state.schema.marks[REDACT_MARK]
  const doc = editor.state.doc
  if (!type || !doc.rangeHasMark(0, doc.content.size, type)) return true
  const count = hiddenSpanCount(editor)
  if (count === 0) return true
  if (odtSaveAgreed && odtSaveAgreed.document === document && odtSaveAgreed.count >= count) {
    return true
  }
  if (auto) return false
  const ok = (await window.desktop.confirmHidingLoss(count)) === true
  if (ok) odtSaveAgreed = { document, count }
  return ok
}
