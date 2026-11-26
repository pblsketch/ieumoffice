import type { zh } from './zh'

export const pl = {
  panelTitle: 'Pliki',
  showPanel: 'Pokaż panel plików',
  hidePanel: 'Ukryj panel plików',
  searchPlaceholder: 'Znajdź plik',
  sectionCurrent: 'Folder tego dokumentu',
  sectionFolders: 'Foldery',
  sectionRecent: 'Ostatnie',
  addFolder: 'Dodaj folder',
  refresh: 'Odśwież',
  collapseAll: 'Zwiń wszystko',
  emptyFolder: 'Brak dokumentów do otwarcia',
  folderMissing: 'Nie znaleziono folderu',
  untitledHint:
    'Ten dokument nie jest jeszcze zapisany. Jego folder pojawi się tutaj po zapisaniu.',
  noResults: 'Brak pasujących plików',
  openMark: 'Otwarty',
  resizePanel: 'Zmień szerokość panelu plików',
  noRecent: 'Brak ostatnich dokumentów',
  searching: 'Wyszukiwanie…',
} satisfies Record<keyof typeof zh, string>
