import {
  confirmHidingLoss,
  countHtmlHidingMarks,
  type HidingLossMessageBox,
} from '@genoffice/electron-utils/hiding-loss'

/**
 * The Word and ODT exports of a page: the copy is built from the rendered
 * page, which has no place for the editor's hiding marks, so the words they
 * hide reach the copy unmarked. With marks on the page the person is asked
 * once before anything is converted; Cancel writes nothing. A headless
 * export (the command line) never asks.
 */
export function htmlHidingLossAllowed(
  html: string,
  headless: boolean,
  show: (options: HidingLossMessageBox) => Promise<{ response: number }>,
): Promise<boolean> {
  if (headless) return Promise.resolve(true)
  return confirmHidingLoss(countHtmlHidingMarks(html), show)
}
