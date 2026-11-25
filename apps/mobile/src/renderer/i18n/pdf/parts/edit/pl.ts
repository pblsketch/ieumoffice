import type { zh } from './zh'

export const pl = {
  pdfEditPen: 'Pióro',
  pdfEditHighlighter: 'Zakreślacz',
  pdfEditTextBox: 'Pole tekstowe',
  pdfEditSign: 'Podpisz',
  pdfEditPages: 'Porządkuj strony',
  pdfEditLink: 'Wstaw link',
  pdfEditSaveFailed: 'Nie udało się zapisać. Twoje zmiany pozostały, a plik nie został zmieniony.',
  pdfEditSaveSkipped: 'Nie udało się zapisać części zmian tekstu na stronie {pages}.',
  pdfEditShareFailed: 'Nie udało się udostępnić.',
  pdfEditReloadFailed:
    'Zapisano, ale nie udało się ponownie wczytać dokumentu. Otwórz plik ponownie.',
  pdfEditSignatureUnavailable: 'Podpisywanie nie jest jeszcze dostępne.',
  pdfEditSaveAsHint:
    'Wybierz sposób traktowania wyróżnień, notatek i rysunków w kopii. „Wtop w strony” wtopi też pola formularzy; „Pomiń adnotacje” zachowa linki i pola formularzy.',
  pdfEditKeepAnnots: 'Zachowaj adnotacje (edytowalne w innych aplikacjach)',
  pdfEditFlattenAnnots: 'Wtop w strony (widoczne w każdej aplikacji)',
  pdfEditStripAnnots: 'Pomiń adnotacje (linki i pola pozostają)',
  pdfEditSaveVerifyFailed:
    'Zmian na stronie {pages} nie udało się zapisać w całości; zapis anulowano, a plik pozostał nietknięty. Cofnij problematyczną edycję i spróbuj ponownie',
} as const satisfies Record<keyof typeof zh, string>
