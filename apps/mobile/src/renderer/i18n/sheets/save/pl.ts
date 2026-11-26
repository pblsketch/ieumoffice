import type { zh } from './zh'

export const pl = {
  sheetsShareFailed: 'Nie udało się udostępnić tego pliku.',
  sheetsSaveFailed: 'Nie udało się zapisać. Oryginalny plik jest bez zmian.',
  sheetsSaveAsTitle: 'Zapisz jako',
  sheetsShareTitle: 'Udostępnij jako',
  sheetsFormatWorkbook: 'Skoroszyt programu Excel (.xlsx)',
  sheetsFormatWorkbookMacro: 'Skoroszyt programu Excel z obsługą makr (.xlsm)',
  sheetsFormatCsv: 'CSV (tylko bieżący arkusz)',
  sheetsFormatOds: 'Arkusz ODS (kopia skoroszytu)',
  sheetsFormatPdf: 'PDF (bieżący arkusz)',
  sheetsOdsEncrypted: 'Skoroszytu z hasłem nie można wyeksportować do ODS.',
  sheetsChoiceCancel: 'Anuluj',
  sheetsCsvAskTitle: 'Zapisz plik CSV',
  sheetsCsvAskMessage: 'Plik CSV zawiera tylko wartości bieżącego arkusza.',
  sheetsCsvAskCsv: 'Zapisz jako CSV (bez formatowania i innych arkuszy)',
  sheetsCsvAskXlsx: 'Zapisz jako plik programu Excel',
  sheetsCsvFormulaTitle: 'Formuły zachowają tylko wartości',
  sheetsCsvFormulaMessage:
    'Formuły tego arkusza zostaną w pliku CSV tylko jako obliczone wartości. Aby zachować formuły, zapisz jako plik programu Excel.',
  sheetsCsvContinue: 'Kontynuuj jako CSV',
  sheetsOdsLossTitle: 'Eksportuj do ODS',
  sheetsOdsLossMessage:
    'Funkcje, których ODS nie obsługuje (formuły, wykresy, obrazy, formatowanie warunkowe itp.), w liczbie {count}, nie trafią do kopii.',
  sheetsOdsContinue: 'Kontynuuj',
  sheetsOdsUnreadable: 'Nie udało się ponownie otworzyć pliku ODS, więc nie został zapisany.',
  sheetsOdsFailed: 'Nie można wyeksportować do ODS.',
  sheetsCopySaved: 'Zapisano kopię: {name}',
  sheetsPdfWorking: 'Tworzenie pliku PDF…',
  sheetsPdfFailed: 'Nie można utworzyć pliku PDF.',
  sheetsPdfSkippedVisuals: 'Nie udało się umieścić w PDF obrazów lub wykresów: {count}.',
  sheetsPdfMissingGlyphs:
    'Znaki, których brak w czcionkach ({count}), są w PDF pustymi prostokątami.',
  sheetsSaveErrDiskChanged:
    'Inna aplikacja zmieniła oryginał po jego otwarciu. Nie został nadpisany; użyj polecenia Zapisz jako.',
  sheetsSaveErrTooLarge:
    'Plik jest za duży (ponad ok. 14 MB), by zapisać go na tym telefonie. Oryginał jest bez zmian.',
  sheetsSaveErrUnreadable:
    'Nie udało się ponownie otworzyć zapisanego skoroszytu, więc oryginał pozostał bez zmian.',
  sheetsSaveErrLockFailed:
    'Nie udało się ponownie zablokować skoroszytu jego hasłem, więc oryginał pozostał bez zmian.',
  sheetsSaveBusy: 'Trwa zapisywanie. Spróbuj ponownie, gdy się zakończy.',
} as const satisfies Record<keyof typeof zh, string>
