import type { zh } from './zh'

export const it = {
  sheetsFreezeTopRow: 'Blocca riga superiore',
  sheetsFreezeFirstColumn: 'Blocca prima colonna',
  sheetsUnfreeze: 'Sblocca riquadri',
  sheetsKeyboardBar: 'Strumenti per le formule',
  sheetsInsertSum: 'Funzione somma',
  sheetsInsertParens: 'Parentesi',
  sheetsNumericKeys: 'Tastiera numerica',
  sheetsCancelEdit: 'Annulla',
  sheetsConfirmEdit: 'Fine',
} as const satisfies Record<keyof typeof zh, string>
