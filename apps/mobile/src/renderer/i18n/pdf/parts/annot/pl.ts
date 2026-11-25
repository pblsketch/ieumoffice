import type { zh } from './zh'

export const pl = {
  pdfAnnotHighlight: 'Wyróżnienie',
  pdfAnnotUnderline: 'Podkreślenie',
  pdfAnnotSquiggly: 'Falista',
  pdfAnnotStrikeout: 'Przekreślenie',
  pdfAnnotModeSelect: 'Zaznacz tekst',
  pdfAnnotModeNote: 'Umieść notatkę',
  pdfAnnotHintSelect:
    'Aby zaznaczyć, przeciągnij w bok po tekście albo naciśnij i przytrzymaj, a potem przeciągnij. Stuknij oznaczenie, aby zmienić jego kolor lub je usunąć.',
  pdfAnnotHintNote: 'Stuknij miejsce, w którym ma być notatka.',
  pdfAnnotPen: 'Zakreślacz {n}',
  pdfAnnotColor: 'Kolor {n}',
  pdfAnnotRemove: 'Usuń oznaczenie',
  pdfAnnotMarkupTitle: 'Kolor oznaczenia',
  pdfAnnotClearSelection: 'Wyczyść zaznaczenie',
  pdfAnnotNoText: 'Na tej stronie nie ma tekstu do zaznaczenia.',
  pdfAnnotOpenNote: 'Otwórz notatkę',
  pdfAnnotFailed: 'Nie udało się zmienić adnotacji.',
  pdfAnnotNewNote: 'Nowa notatka',
  pdfAnnotReplyPlaceholder: 'Napisz odpowiedź',
} as const satisfies Record<keyof typeof zh, string>
