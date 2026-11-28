import type { zh } from './zh'

export const de = {
  panelTitle: 'Dateien',
  showPanel: 'Dateibereich einblenden',
  hidePanel: 'Dateibereich ausblenden',
  searchPlaceholder: 'Datei suchen',
  sectionCurrent: 'Ordner dieses Dokuments',
  sectionFolders: 'Ordner',
  sectionRecent: 'Zuletzt verwendet',
  addFolder: 'Ordner hinzufügen',
  refresh: 'Aktualisieren',
  collapseAll: 'Alle zuklappen',
  emptyFolder: 'Hier gibt es keine Dokumente zum Öffnen',
  folderMissing: 'Ordner nicht gefunden',
  untitledHint:
    'Dieses Dokument ist noch nicht gespeichert. Sein Ordner erscheint hier, sobald Sie es speichern.',
  noResults: 'Keine passenden Dateien',
  openMark: 'Geöffnet',
  resizePanel: 'Breite des Dateibereichs ändern',
  noRecent: 'Keine zuletzt verwendeten Dokumente',
  searching: 'Suche läuft…',
  quickLook: 'Schnellvorschau',
} satisfies Record<keyof typeof zh, string>
