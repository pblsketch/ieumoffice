import type { zh } from './zh'

export const pl = {
  pdfLinkPlaceHint: 'Przeciągnij ramkę na stronie w miejscu łącza',
  pdfLinkEditTitle: 'Edytuj łącze',
  pdfLinkUrlLabel: 'Adres internetowy (http, https, mailto)',
  pdfLinkPageLabel: 'Lub strona w tym dokumencie (1–{count})',
  pdfLinkUrlInvalid: 'Można łączyć tylko adresy http, https i mailto',
  pdfLinkPageInvalid: 'Wpisz numer strony od 1 do {count}',
  pdfLinkNeedTarget: 'Wpisz adres internetowy lub numer strony',
  pdfLinkApply: 'Dodaj łącze',
  pdfLinkDelete: 'Usuń łącze',
  pdfLinkPending: 'Łącze do dodania: {target}',
  pdfLinkToPage: 'Strona {page}',
  pdfLinkFailed: 'Nie udało się zmienić łącza. Spróbuj ponownie po zakończeniu zapisywania.',
  pdfLinkUpdate: 'Zastosuj',
} as const satisfies Record<keyof typeof zh, string>
