import type { zh } from './zh'

export const de = {
  homeTabNav: 'Startmenü',
  homeTabRecent: 'Zuletzt',
  homeTabFolders: 'Ordner',
  homeTabTools: 'Werkzeuge',
  homeTabSettings: 'Einstellungen',
  homeListAll: 'Alle',
  homeListFavorites: 'Favoriten',
  homeListChips: 'Liste filtern',
  homeListFamilyHwp: 'HWP',
  homeListFamilyMd: 'Markdown',
  homeListFavoritesEmpty:
    'Noch keine Favoriten. Über das [⋯] einer Datei können Sie sie zu den Favoriten hinzufügen.',
  homeListGroupEmpty: 'In dieser Gruppe sind noch keine Dateien.',
  homeListFavoriteLost:
    'Diese Datei lässt sich nicht öffnen. Sie wurde vielleicht verschoben oder gelöscht.',
  homeEmptyText:
    'Sie haben noch kein Dokument geöffnet. Sehen Sie sich das Beispieldokument an oder öffnen Sie eine Datei.',
  homeEmptySample: 'Beispieldokument öffnen',
  homeEmptyCreate: 'Neu erstellen',
  homeCreateFab: 'Neu erstellen',
  homeCreateTitle: 'Neu erstellen',
  homeCreateClose: 'Schließen',
  homeCreatePdfTools: 'PDF-Werkzeuge',
} as const satisfies Record<keyof typeof zh, string>
