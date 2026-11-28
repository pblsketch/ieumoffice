import type { zh } from './zh'

export const nl = {
  pdfDrawSettings: 'Peninstellingen',
  pdfDrawTool: 'Gereedschap',
  pdfDrawPen: 'Pen',
  pdfDrawRect: 'Rechthoek',
  pdfDrawEllipse: 'Ellips',
  pdfDrawLine: 'Lijn',
  pdfDrawArrow: 'Pijl',
  pdfDrawEraser: 'Gum',
  pdfDrawColor: 'Kleur',
  pdfDrawColorRed: 'Rood',
  pdfDrawColorYellow: 'Geel',
  pdfDrawColorGreen: 'Groen',
  pdfDrawColorBlue: 'Blauw',
  pdfDrawColorBlack: 'Zwart',
  pdfDrawWidth: 'Dikte',
  pdfDrawWidthValue: '{width} pt',
  pdfDrawFinger: 'Ook met vinger tekenen',
  pdfDrawFingerHint:
    'Aan: je vinger blijft tekenen, ook nadat je een pen hebt gebruikt. Uit: nadat je een pen hebt gebruikt, verschuift je vinger de pagina.',
  pdfDrawEraserHint: 'De gum wist alleen lijnen en vormen die nog niet zijn opgeslagen.',
  pdfDrawRefused: 'Tekenen kan nu niet. Probeer het zo opnieuw.',
} as const satisfies Record<keyof typeof zh, string>
