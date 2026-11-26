import type { zh } from './zh'

export const de = {
  sheetsFreezeTopRow: 'Oberste Zeile fixieren',
  sheetsFreezeFirstColumn: 'Erste Spalte fixieren',
  sheetsUnfreeze: 'Fixierung aufheben',
  sheetsKeyboardBar: 'Werkzeuge für Formeleingabe',
  sheetsInsertSum: 'Summenfunktion',
  sheetsInsertParens: 'Klammern',
  sheetsNumericKeys: 'Zahlentastatur',
  sheetsCancelEdit: 'Abbrechen',
  sheetsConfirmEdit: 'Fertig',
} as const satisfies Record<keyof typeof zh, string>
