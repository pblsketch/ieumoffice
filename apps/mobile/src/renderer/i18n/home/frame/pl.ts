import type { zh } from './zh'

export const pl = {
  homeTabNav: 'Menu ekranu głównego',
  homeTabRecent: 'Ostatnie',
  homeTabFolders: 'Foldery',
  homeTabTools: 'Narzędzia',
  homeTabSettings: 'Ustawienia',
  homeListAll: 'Wszystkie',
  homeListFavorites: 'Ulubione',
  homeListChips: 'Filtruj listę',
  homeListFamilyHwp: 'HWP',
  homeListFamilyMd: 'Markdown',
  homeListFavoritesEmpty: 'Nie masz jeszcze ulubionych. Dodaj plik do ulubionych z jego menu [⋯].',
  homeListGroupEmpty: 'W tej grupie nie ma jeszcze plików.',
  homeListFavoriteLost: 'Nie można otworzyć tego pliku. Mógł zostać przeniesiony lub usunięty.',
  homeEmptyText:
    'Nie otwarto jeszcze żadnego dokumentu. Zobacz dokument przykładowy albo otwórz plik.',
  homeEmptySample: 'Otwórz dokument przykładowy',
  homeEmptyCreate: 'Utwórz nowy',
  homeCreateFab: 'Utwórz nowy',
  homeCreateTitle: 'Utwórz nowy',
  homeCreateClose: 'Zamknij',
  homeCreatePdfTools: 'Narzędzia PDF',
} as const satisfies Record<keyof typeof zh, string>
