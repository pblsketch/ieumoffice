import type { zh } from './zh'

export const pl = {
  pdfTextHint: 'Dotknij pustego miejsca, aby dodać tekst, lub dotknij tekstu, aby go edytować.',
  pdfTextInputLabel: 'Tekst do dodania',
  pdfTextEditLabel: 'Tekst do edycji',
  pdfTextStyleBar: 'Styl tekstu',
  pdfTextBold: 'Pogrubienie',
  pdfTextSize: 'Rozmiar tekstu',
  pdfTextSizeDown: 'Zmniejsz tekst',
  pdfTextSizeUp: 'Powiększ tekst',
  pdfTextColor: 'Kolor tekstu',
  pdfTextColorDocument: 'Zachowaj kolor dokumentu',
  pdfTextFont: 'Czcionka',
  pdfTextFontDocument: 'Czcionka dokumentu',
  pdfTextBack: 'Wstecz',
  pdfTextDelete: 'Usuń',
  pdfTextDone: 'Gotowe',
  pdfTextCannotDraw: 'Tych znaków nie można dodać: {chars}',
  pdfTextFontSubstituted: 'Te znaki zostaną wyświetlone inną czcionką: {chars}',
  pdfTextScannedPage: 'Ta strona nie zawiera tekstu. Możesz tylko dodać nowy tekst.',
  pdfTextNoMatch: 'Nie można edytować tego tekstu: nie znaleziono go w dokumencie.',
  pdfTextOverflow: 'Edytowany tekst nachodziłby na tekst poniżej. Skróć go.',
} as const satisfies Record<keyof typeof zh, string>
