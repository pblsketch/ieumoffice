import type { zh } from './zh'

export const cs = {
  pdfDrawSettings: 'Nastavení pera',
  pdfDrawTool: 'Nástroj',
  pdfDrawPen: 'Pero',
  pdfDrawRect: 'Obdélník',
  pdfDrawEllipse: 'Elipsa',
  pdfDrawLine: 'Čára',
  pdfDrawArrow: 'Šipka',
  pdfDrawEraser: 'Guma',
  pdfDrawColor: 'Barva',
  pdfDrawColorRed: 'Červená',
  pdfDrawColorYellow: 'Žlutá',
  pdfDrawColorGreen: 'Zelená',
  pdfDrawColorBlue: 'Modrá',
  pdfDrawColorBlack: 'Černá',
  pdfDrawWidth: 'Tloušťka',
  pdfDrawWidthValue: '{width} b.',
  pdfDrawFinger: 'Kreslit i prstem',
  pdfDrawFingerHint:
    'Když je zapnuto, prst kreslí i po použití pera. Když je vypnuto, po použití pera prst posouvá stránku.',
  pdfDrawEraserHint: 'Guma maže jen tahy a tvary, které ještě nejsou uložené.',
  pdfDrawRefused: 'Teď nelze kreslit. Zkuste to za chvíli znovu.',
} as const satisfies Record<keyof typeof zh, string>
