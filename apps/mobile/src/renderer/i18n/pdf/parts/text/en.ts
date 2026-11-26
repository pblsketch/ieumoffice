import type { zh } from './zh'

export const en = {
  pdfTextHint: 'Tap empty space to add text, or tap text to edit it.',
  pdfTextInputLabel: 'Text to add',
  pdfTextEditLabel: 'Text to edit',
  pdfTextStyleBar: 'Text style',
  pdfTextBold: 'Bold',
  pdfTextSize: 'Font size',
  pdfTextSizeDown: 'Smaller text',
  pdfTextSizeUp: 'Larger text',
  pdfTextColor: 'Text color',
  pdfTextColorDocument: 'Keep document color',
  pdfTextFont: 'Font',
  pdfTextFontDocument: 'Document font',
  pdfTextBack: 'Back',
  pdfTextDelete: 'Delete',
  pdfTextDone: 'Done',
  pdfTextCannotDraw: 'These characters cannot be added: {chars}',
  pdfTextFontSubstituted: 'These characters will use a different font: {chars}',
  pdfTextScannedPage: 'This page has no text. You can only add new text.',
  pdfTextNoMatch: 'This text cannot be edited: it was not found in the document.',
  pdfTextOverflow: 'The edited text would overlap the text below. Please shorten it.',
} as const satisfies Record<keyof typeof zh, string>
