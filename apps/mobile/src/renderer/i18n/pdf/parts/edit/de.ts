import type { zh } from './zh'

export const de = {
  pdfEditPen: 'Stift',
  pdfEditHighlighter: 'Textmarker',
  pdfEditTextBox: 'Textfeld',
  pdfEditSign: 'Unterschreiben',
  pdfEditPages: 'Seiten organisieren',
  pdfEditLink: 'Link einfügen',
  pdfEditSaveFailed:
    'Speichern nicht möglich. Ihre Änderungen bleiben erhalten, die Datei wurde nicht verändert.',
  pdfEditSaveSkipped: 'Einige Textänderungen auf Seite {pages} konnten nicht gespeichert werden.',
  pdfEditShareFailed: 'Teilen nicht möglich.',
  pdfEditReloadFailed:
    'Gespeichert, aber das Dokument konnte nicht neu geladen werden. Öffnen Sie die Datei erneut.',
  pdfEditSignatureUnavailable: 'Unterschreiben ist noch nicht verfügbar.',
  pdfEditSaveAsHint:
    'Legen Sie fest, wie Markierungen, Notizen und Zeichnungen in der Kopie behandelt werden. „In Seiten einbrennen“ brennt auch Formularfelder ein; „Anmerkungen weglassen“ behält Links und Formularfelder.',
  pdfEditKeepAnnots: 'Anmerkungen behalten (in anderen Apps bearbeitbar)',
  pdfEditFlattenAnnots: 'In Seiten einbrennen (in jeder App sichtbar)',
  pdfEditStripAnnots: 'Anmerkungen weglassen (Links und Formularfelder bleiben)',
  pdfEditSaveVerifyFailed:
    'Die Änderungen auf Seite {pages} konnten nicht vollständig zurückgeschrieben werden; das Speichern wurde abgebrochen und die Datei blieb unverändert. Machen Sie die betroffene Bearbeitung rückgängig und versuchen Sie es erneut',
} as const satisfies Record<keyof typeof zh, string>
