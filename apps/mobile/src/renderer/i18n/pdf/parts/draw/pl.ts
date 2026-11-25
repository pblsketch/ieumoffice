import type { zh } from './zh'

export const pl = {
  pdfDrawSettings: 'Ustawienia pióra',
  pdfDrawTool: 'Narzędzie',
  pdfDrawPen: 'Pióro',
  pdfDrawRect: 'Prostokąt',
  pdfDrawEllipse: 'Elipsa',
  pdfDrawLine: 'Linia',
  pdfDrawArrow: 'Strzałka',
  pdfDrawEraser: 'Gumka',
  pdfDrawColor: 'Kolor',
  pdfDrawColorRed: 'Czerwony',
  pdfDrawColorYellow: 'Żółty',
  pdfDrawColorGreen: 'Zielony',
  pdfDrawColorBlue: 'Niebieski',
  pdfDrawColorBlack: 'Czarny',
  pdfDrawWidth: 'Grubość',
  pdfDrawWidthValue: '{width} pkt',
  pdfDrawFinger: 'Rysuj także palcem',
  pdfDrawFingerHint:
    'Gdy włączone, palec rysuje również po użyciu pióra. Gdy wyłączone, po użyciu pióra palec przesuwa stronę.',
  pdfDrawEraserHint:
    'Gumka usuwa tylko pociągnięcia i kształty, które nie zostały jeszcze zapisane.',
  pdfDrawRefused: 'Nie można teraz rysować. Spróbuj ponownie za chwilę.',
} as const satisfies Record<keyof typeof zh, string>
