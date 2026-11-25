import type { zh } from './zh'

export const en = {
  pdfDrawSettings: 'Pen settings',
  pdfDrawTool: 'Tool',
  pdfDrawPen: 'Pen',
  pdfDrawRect: 'Rectangle',
  pdfDrawEllipse: 'Ellipse',
  pdfDrawLine: 'Line',
  pdfDrawArrow: 'Arrow',
  pdfDrawEraser: 'Eraser',
  pdfDrawColor: 'Color',
  pdfDrawColorRed: 'Red',
  pdfDrawColorYellow: 'Yellow',
  pdfDrawColorGreen: 'Green',
  pdfDrawColorBlue: 'Blue',
  pdfDrawColorBlack: 'Black',
  pdfDrawWidth: 'Width',
  pdfDrawWidthValue: '{width} pt',
  pdfDrawFinger: 'Draw with finger too',
  pdfDrawFingerHint:
    'When on, your finger still draws after you have used a pen. When off, once a pen has been used your finger moves the page.',
  pdfDrawEraserHint: 'The eraser removes only strokes and shapes that are not saved yet.',
  pdfDrawRefused: "Can't draw right now. Try again in a moment.",
} as const satisfies Record<keyof typeof zh, string>
