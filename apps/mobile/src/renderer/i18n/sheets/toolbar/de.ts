import type { zh } from './zh'

export const de = {
  sheetsToolbarFormat: 'Zellformat',
  sheetsToolbarRows: 'Zeilen und Spalten',
  sheetsToolbarSort: 'Sortieren und filtern',
  sheetsToolbarInsert: 'Einfügen',
  sheetsToolbarInsertValues: 'Datum und Blätter',
  sheetsToolbarToday: 'Heutiges Datum',
  sheetsToolbarTimeNow: 'Aktuelle Uhrzeit',
  sheetsToolbarNewSheet: 'Neues Blatt',
  sheetsToolbarFind: 'Suchen',
  sheetsToolbarViewOnly:
    'Diagramme, PivotTables und bedingte Formatierung sind hier nur zum Ansehen. Öffnen Sie die Datei am Computer, um sie zu ändern.',
  sheetsToolbarFullLoaded:
    'Die ganze Arbeitsmappe ist geladen. Tippen Sie erneut auf Sortieren oder Filtern.',
} as const satisfies Record<keyof typeof zh, string>
