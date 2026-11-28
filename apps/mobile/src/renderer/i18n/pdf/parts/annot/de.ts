import type { zh } from './zh'

export const de = {
  pdfAnnotHighlight: 'Hervorheben',
  pdfAnnotUnderline: 'Unterstreichen',
  pdfAnnotSquiggly: 'Wellenlinie',
  pdfAnnotStrikeout: 'Durchstreichen',
  pdfAnnotModeSelect: 'Text auswählen',
  pdfAnnotModeNote: 'Notiz platzieren',
  pdfAnnotHintSelect:
    'Zum Auswählen seitlich über den Text ziehen oder lange drücken und dann ziehen. Tippen Sie auf eine Markierung, um ihre Farbe zu ändern oder sie zu entfernen.',
  pdfAnnotHintNote: 'Tippen Sie auf die Stelle für die Notiz.',
  pdfAnnotPen: 'Textmarker {n}',
  pdfAnnotColor: 'Farbe {n}',
  pdfAnnotRemove: 'Markierung entfernen',
  pdfAnnotMarkupTitle: 'Farbe der Markierung',
  pdfAnnotClearSelection: 'Auswahl aufheben',
  pdfAnnotNoText: 'Auf dieser Seite gibt es keinen auswählbaren Text.',
  pdfAnnotOpenNote: 'Notiz öffnen',
  pdfAnnotFailed: 'Die Anmerkung konnte nicht geändert werden.',
  pdfAnnotNewNote: 'Neue Notiz',
  pdfAnnotReplyPlaceholder: 'Antwort schreiben',
} as const satisfies Record<keyof typeof zh, string>
