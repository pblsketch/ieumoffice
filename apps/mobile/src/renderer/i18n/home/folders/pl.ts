import type { zh } from './zh'

export const pl = {
  homeFolderListLabel: 'Połączone foldery',
  homeFolderEmptyTitle: 'Brak połączonych folderów',
  homeFolderEmptyBody: 'Połącz często używany folder, a jego dokumenty i obrazy pojawią się tutaj.',
  homeFolderLink: 'Dodaj folder',
  homeFolderRelink: 'Połącz ponownie',
  homeFolderRelinkNamed: 'Połącz ponownie {name}',
  homeFolderOk: 'Połączony',
  homeFolderLostRevoked: 'Utracono uprawnienia do tego folderu. Połącz go ponownie.',
  homeFolderLostMissing:
    'Nie znaleziono tego folderu. Jeśli go przeniesiono lub usunięto, połącz go ponownie.',
  homeFolderLost: 'Brak dostępu do folderu. Połącz go ponownie.',
  homeFolderMenu: 'Menu: {name}',
  homeFolderRemove: 'Usuń',
  homeFolderRemoveTitle: 'Usunąć folder „{name}”?',
  homeFolderRemoveBody:
    'Wpisy w ostatnich i ulubionych dla plików z tego folderu (liczba: {count}) również zostaną usunięte. Same pliki zostaną.',
  homeFolderRemoved: 'Folder usunięty.',
  homeFolderBack: 'Folder wyżej',
  homeFolderPath: 'Bieżący folder',
  homeFolderSubfolder: 'Folder',
  homeFolderInsideEmpty: 'W tym folderze nie ma dokumentów ani obrazów do otwarcia.',
} as const satisfies Record<keyof typeof zh, string>
