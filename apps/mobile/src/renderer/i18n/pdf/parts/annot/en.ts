import type { zh } from './zh'

export const en = {
  pdfAnnotHighlight: 'Highlight',
  pdfAnnotUnderline: 'Underline',
  pdfAnnotSquiggly: 'Squiggly',
  pdfAnnotStrikeout: 'Strikethrough',
  pdfAnnotModeSelect: 'Select text',
  pdfAnnotModeNote: 'Place note',
  pdfAnnotHintSelect:
    'Drag sideways across text, or press and hold then drag, to select. Tap a markup to recolor or remove it.',
  pdfAnnotHintNote: 'Tap where the note should go.',
  pdfAnnotPen: 'Highlighter {n}',
  pdfAnnotColor: 'Color {n}',
  pdfAnnotRemove: 'Remove markup',
  pdfAnnotMarkupTitle: 'Markup color',
  pdfAnnotClearSelection: 'Clear selection',
  pdfAnnotNoText: 'There is no selectable text on this page.',
  pdfAnnotOpenNote: 'Open note',
  pdfAnnotFailed: 'Could not change the annotation.',
  pdfAnnotNewNote: 'New note',
  pdfAnnotReplyPlaceholder: 'Write a reply',
} as const satisfies Record<keyof typeof zh, string>
