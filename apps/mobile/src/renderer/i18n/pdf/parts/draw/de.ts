import type { zh } from './zh'

export const de = {
  pdfDrawSettings: 'Stifteinstellungen',
  pdfDrawTool: 'Werkzeug',
  pdfDrawPen: 'Stift',
  pdfDrawRect: 'Rechteck',
  pdfDrawEllipse: 'Ellipse',
  pdfDrawLine: 'Linie',
  pdfDrawArrow: 'Pfeil',
  pdfDrawEraser: 'Radierer',
  pdfDrawColor: 'Farbe',
  pdfDrawColorRed: 'Rot',
  pdfDrawColorYellow: 'Gelb',
  pdfDrawColorGreen: 'Grün',
  pdfDrawColorBlue: 'Blau',
  pdfDrawColorBlack: 'Schwarz',
  pdfDrawWidth: 'Stärke',
  pdfDrawWidthValue: '{width} pt',
  pdfDrawFinger: 'Auch mit dem Finger zeichnen',
  pdfDrawFingerHint:
    'Ein: Der Finger zeichnet auch, nachdem ein Stift benutzt wurde. Aus: Sobald ein Stift benutzt wurde, verschiebt der Finger die Seite.',
  pdfDrawEraserHint:
    'Der Radierer entfernt nur Striche und Formen, die noch nicht gespeichert sind.',
  pdfDrawRefused: 'Zeichnen ist gerade nicht möglich. Versuchen Sie es gleich noch einmal.',
} as const satisfies Record<keyof typeof zh, string>
