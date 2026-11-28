import type { zh } from './zh'

export const pl = {
  staleDialogTitle: 'Elementy wymagają aktualizacji',
  staleDialogBody:
    'Poniższe elementy mogą być nieaktualne po ostatnich zmianach. Czy odświeżyć je przed kontynuowaniem?',
  staleActionSave: 'Zapisz',
  staleActionPrint: 'Drukuj',
  staleActionPdf: 'Eksportuj PDF',
  staleActionSubmission: 'Zapisz kopię do złożenia',
  staleBtnRefreshAll: 'Odśwież wszystko',
  staleBtnContinue: 'Kontynuuj mimo to',
  staleBtnCancel: 'Anuluj',
  staleReasonPagesChanged: 'Zmieniono numery stron',
  staleReasonEntriesChanged: 'Zmieniono wpisy',
  staleKindTocBody: 'Spis treści',
  staleKindTocTable: 'Spis tabel',
  staleKindTocFigure: 'Spis rysunków',
  staleKindTocEquation: 'Spis wzorów',
  staleKindIndex: 'Indeks',
  staleKindBibliography: 'Bibliografia',
  staleManualConfirmTitle: 'Wykryto ręczne zmiany',
  staleManualConfirmBody: 'Wykryto ręczne modyfikacje w: {items}. Czy nadpisać je i odświeżyć?',
  staleManualOverwrite: 'Nadpisz i odśwież',
  staleManualSkip: 'Pomiń',
  staleRefreshDone: 'Zaktualizowano {count} elementów.',
  staleRefreshFailed: 'Nie udało się zaktualizować niektórych elementów: {error}',
  staleRefreshBlockedObjects:
    'Pominięto odświeżanie, ponieważ zakres spisu treści lub indeksu zawiera obiekty użytkownika, takie jak przypisy dolne, obrazy lub tabele.',
  submissionMenuLabel: 'Zapisz jako kopię do złożenia…',
  submissionMenuDesc: 'Zapisuje osobną czystą kopię bez znaczników indeksu, cytowań i ustawień.',
  submissionSaving: 'Tworzenie kopii do złożenia…',
  submissionSaved: 'Zapisano kopię do złożenia: {name}',
  submissionBackupKept: 'Zachowano kopię zapasową poprzedniego pliku: {name}',
  submissionSavedTailsLost:
    'Zapisano kopię do złożenia ({name}). Niektóre strony wzorcowe lub komentarze mogły nie zostać zachowane.',
  submissionFailedProtected:
    'Dokumenty chronione hasłem nie mogą zostać zapisane jako kopia do złożenia.',
  submissionFailedTracked:
    'Dokumenty ze śledzeniem zmian nie mogą zostać zapisane jako kopia do złożenia.',
  submissionFailedSameAsOpen:
    'Nie można nadpisać otwartego dokumentu kopią do złożenia. Wybierz inną nazwę pliku.',
  submissionFailedStrip:
    'Nie zapisano kopii do złożenia, ponieważ nie udało się usunąć niektórych znaczników wewnętrznych: {marks}',
  submissionFailedVerify:
    'Weryfikacja kopii do złożenia nie powiodła się ({before} → {after} stron). Spróbuj zapisać w formacie HWPX.',
  submissionFailedExport: 'Nie udało się utworzyć kopii do złożenia: {error}',
  submissionFailedWrite: 'Nie udało się zapisać kopii do złożenia: {error}',
} satisfies Record<keyof typeof zh, string>
