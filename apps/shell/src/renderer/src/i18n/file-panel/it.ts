import type { zh } from './zh'

export const it = {
  panelTitle: 'File',
  showPanel: 'Mostra pannello file',
  hidePanel: 'Nascondi pannello file',
  searchPlaceholder: 'Cerca un file',
  sectionCurrent: 'Cartella di questo documento',
  sectionFolders: 'Cartelle',
  sectionRecent: 'Recenti',
  addFolder: 'Aggiungi cartella',
  refresh: 'Aggiorna',
  collapseAll: 'Comprimi tutto',
  emptyFolder: 'Nessun documento da aprire qui',
  folderMissing: 'Cartella non trovata',
  untitledHint:
    'Questo documento non è ancora stato salvato. La sua cartella apparirà qui dopo il salvataggio.',
  noResults: 'Nessun file corrispondente',
  openMark: 'Aperto',
  resizePanel: 'Ridimensiona il pannello file',
  noRecent: 'Nessun documento recente',
  searching: 'Ricerca in corso…',
  quickLook: 'Visualizzazione rapida',
} satisfies Record<keyof typeof zh, string>
