import type { zh } from './zh'

export const it = {
  sheetsToolbarFormat: 'Formato cella',
  sheetsToolbarRows: 'Righe e colonne',
  sheetsToolbarSort: 'Ordina e filtra',
  sheetsToolbarInsert: 'Inserisci',
  sheetsToolbarInsertValues: 'Date e fogli',
  sheetsToolbarToday: 'Data di oggi',
  sheetsToolbarTimeNow: 'Ora attuale',
  sheetsToolbarNewSheet: 'Nuovo foglio',
  sheetsToolbarFind: 'Trova',
  sheetsToolbarViewOnly:
    'Grafici, tabelle pivot e formattazione condizionale qui sono solo da visualizzare. Apri il file su un computer per modificarli.',
  sheetsToolbarFullLoaded:
    "L'intera cartella di lavoro è caricata. Tocca di nuovo ordina o filtra.",
} as const satisfies Record<keyof typeof zh, string>
