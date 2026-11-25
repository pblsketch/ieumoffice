import type { zh } from './zh'

export const pl = {
  homeSetEditorsTitle: 'Edytory',
  homeSetEditorsHint:
    'Wyłączone edytory znikają z listy nowych dokumentów. Wyłączenie wszystkich oznacza, że wszystkie są włączone.',
  homeSetEditorHwp: 'HWP',
  homeSetEditorMarkdown: 'Markdown',
  homeSetEditorPdfTools: 'Narzędzia PDF',
  homeSetCardsTitle: 'Nowe dokumenty na ekranie głównym',
  homeSetCardShow: 'Pokazuj {name} na ekranie głównym',
  homeSetCardUp: 'Przesuń {name} w górę',
  homeSetCardDown: 'Przesuń {name} w dół',
  homeSetKeepScreenOn: 'Nie wygaszaj ekranu podczas czytania',
  homeSetKeepScreenOnDesc: 'Ekran nie gaśnie, gdy czytasz PDF lub EPUB albo prezentujesz PPT.',
  homeSetFoldersTitle: 'Foldery z dokumentami',
  homeSetFoldersEmpty:
    'Brak połączonych folderów. Połącz folder, aby widzieć jego pliki od razu na karcie Foldery.',
  homeSetFolderLink: 'Połącz folder',
  homeSetFolderRelink: 'Połącz ponownie',
  homeSetFolderRemove: 'Usuń',
  homeSetFolderRemoveNamed: 'Usuń {name}',
  homeSetFolderOk: 'Połączony',
  homeSetFolderLost:
    'Brak dostępu do tego folderu. Jeśli go przeniesiono lub usunięto, połącz go ponownie.',
  homeSetFolderRemoveTitle: 'Usunąć folder „{name}”?',
  homeSetFolderRemoveBody:
    'Wpisy w ostatnich i ulubionych dla plików z tego folderu (liczba: {count}) również zostaną usunięte. Same pliki zostaną.',
  homeSetBackupsTotal: 'Razem {size}',
  homeSetStorageTitle: 'Pamięć',
  homeSetStorageRecovery: 'Kopie odzyskiwania',
  homeSetStorageTemp: 'Pliki tymczasowe',
  homeSetStorageBackups: 'Kopie oryginalnych plików HWP',
  homeSetStorageClearTemp: 'Wyczyść pliki tymczasowe',
  homeSetStorageClearRecovery: 'Wyczyść wszystkie kopie odzyskiwania',
  homeSetStorageClearTempTitle: 'Wyczyścić pliki tymczasowe?',
  homeSetStorageClearTempBody:
    'Zostaną usunięte pliki tworzone na chwilę podczas udostępniania lub odbierania. Twoje dokumenty się nie zmienią.',
  homeSetStorageClearRecoveryTitle: 'Wyczyścić wszystkie kopie odzyskiwania?',
  homeSetStorageClearRecoveryBody:
    'Niezapisane zmiany przepadną. Kopia odzyskiwania otwartego teraz dokumentu zostanie zachowana.',
  homeSetStorageClearAction: 'Wyczyść',
  homeSetStorageCleared: 'Zwolniono {size}.',
  homeSetFailed: 'Nie udało się. Spróbuj ponownie za chwilę.',
} as const satisfies Record<keyof typeof zh, string>
