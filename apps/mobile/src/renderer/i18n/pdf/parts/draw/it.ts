import type { zh } from './zh'

export const it = {
  pdfDrawSettings: 'Impostazioni penna',
  pdfDrawTool: 'Strumento',
  pdfDrawPen: 'Penna',
  pdfDrawRect: 'Rettangolo',
  pdfDrawEllipse: 'Ellisse',
  pdfDrawLine: 'Linea',
  pdfDrawArrow: 'Freccia',
  pdfDrawEraser: 'Gomma',
  pdfDrawColor: 'Colore',
  pdfDrawColorRed: 'Rosso',
  pdfDrawColorYellow: 'Giallo',
  pdfDrawColorGreen: 'Verde',
  pdfDrawColorBlue: 'Blu',
  pdfDrawColorBlack: 'Nero',
  pdfDrawWidth: 'Spessore',
  pdfDrawWidthValue: '{width} pt',
  pdfDrawFinger: 'Disegna anche con il dito',
  pdfDrawFingerHint:
    'Attivo: il dito disegna anche dopo aver usato una penna. Disattivo: dopo aver usato una penna, il dito sposta la pagina.',
  pdfDrawEraserHint: 'La gomma cancella solo i tratti e le forme non ancora salvati.',
  pdfDrawRefused: 'Impossibile disegnare ora. Riprova tra poco.',
} as const satisfies Record<keyof typeof zh, string>
