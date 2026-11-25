import type { zh } from './zh'

export const it = {
  sheetsProvisionalNotice: 'Griglia di prova: le modifiche non vengono ancora salvate.',
  sheetsLoading: 'Caricamento della griglia…',
  sheetsShareFailed: 'Impossibile condividere questo file.',
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
