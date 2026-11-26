import type { zh } from './zh'

export const nl = {
  sheetsToolbarFormat: 'Celopmaak',
  sheetsToolbarRows: 'Rijen en kolommen',
  sheetsToolbarSort: 'Sorteren en filteren',
  sheetsToolbarInsert: 'Invoegen',
  sheetsToolbarInsertValues: 'Datums en bladen',
  sheetsToolbarToday: 'Datum van vandaag',
  sheetsToolbarTimeNow: 'Huidige tijd',
  sheetsToolbarNewSheet: 'Nieuw blad',
  sheetsToolbarFind: 'Zoeken',
  sheetsToolbarViewOnly:
    'Grafieken, draaitabellen en voorwaardelijke opmaak zijn hier alleen te bekijken. Open het bestand op een computer om ze te wijzigen.',
  sheetsToolbarFullLoaded: 'De hele werkmap is geladen. Tik nogmaals op sorteren of filteren.',
} as const satisfies Record<keyof typeof zh, string>
