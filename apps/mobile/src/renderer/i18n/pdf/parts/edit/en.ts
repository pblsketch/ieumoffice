import type { zh } from './zh'

export const en = {
  pdfEditPen: 'Pen',
  pdfEditHighlighter: 'Highlighter',
  pdfEditTextBox: 'Text box',
  pdfEditSign: 'Sign',
  pdfEditPages: 'Organize pages',
  pdfEditLink: 'Insert link',
  pdfEditSaveFailed: 'Could not save. Your changes are kept and the file was not changed.',
  pdfEditSaveSkipped: 'Some text edits on page {pages} could not be saved.',
  pdfEditShareFailed: 'Could not share.',
  pdfEditReloadFailed: 'Saved, but the document could not be reloaded. Open the file again.',
  pdfEditSignatureUnavailable: 'Signing is not available yet.',
  pdfEditSaveAsHint:
    'Choose how highlights, notes and drawings are handled in the copy. “Bake into pages” also bakes form fields; “Leave annotations out” keeps links and form fields.',
  pdfEditKeepAnnots: 'Keep annotations (editable in other apps)',
  pdfEditFlattenAnnots: 'Bake into pages (visible in every app)',
  pdfEditStripAnnots: 'Leave annotations out (links and form fields stay)',
  pdfEditSaveVerifyFailed:
    'Changes on page {pages} could not be written back intact, so the save was cancelled and the file left untouched; undo the affected edit and try again',
} as const satisfies Record<keyof typeof zh, string>
