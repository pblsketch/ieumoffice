import type { zh } from './zh'

export const cs = {
  sheetsToolbarFormat: 'Formát buňky',
  sheetsToolbarRows: 'Řádky a sloupce',
  sheetsToolbarSort: 'Řazení a filtr',
  sheetsToolbarInsert: 'Vložit',
  sheetsToolbarInsertValues: 'Data a listy',
  sheetsToolbarToday: 'Dnešní datum',
  sheetsToolbarTimeNow: 'Aktuální čas',
  sheetsToolbarNewSheet: 'Nový list',
  sheetsToolbarFind: 'Najít',
  sheetsToolbarViewOnly:
    'Grafy, kontingenční tabulky a podmíněné formátování lze zde jen zobrazit. Chcete-li je změnit, otevřete soubor v počítači.',
  sheetsToolbarFullLoaded: 'Celý sešit je načtený. Klepněte znovu na řazení nebo filtr.',
} as const satisfies Record<keyof typeof zh, string>
