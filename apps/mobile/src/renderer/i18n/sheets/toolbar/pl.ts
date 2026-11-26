import type { zh } from './zh'

export const pl = {
  sheetsToolbarFormat: 'Format komórki',
  sheetsToolbarRows: 'Wiersze i kolumny',
  sheetsToolbarSort: 'Sortuj i filtruj',
  sheetsToolbarInsert: 'Wstaw',
  sheetsToolbarInsertValues: 'Daty i arkusze',
  sheetsToolbarToday: 'Dzisiejsza data',
  sheetsToolbarTimeNow: 'Bieżąca godzina',
  sheetsToolbarNewSheet: 'Nowy arkusz',
  sheetsToolbarFind: 'Znajdź',
  sheetsToolbarViewOnly:
    'Wykresy, tabele przestawne i formatowanie warunkowe można tu tylko oglądać. Aby je zmienić, otwórz plik na komputerze.',
  sheetsToolbarFullLoaded: 'Cały skoroszyt jest wczytany. Stuknij ponownie sortowanie lub filtr.',
} as const satisfies Record<keyof typeof zh, string>
