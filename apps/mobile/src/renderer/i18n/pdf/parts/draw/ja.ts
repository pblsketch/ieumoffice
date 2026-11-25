import type { zh } from './zh'

export const ja = {
  pdfDrawSettings: 'ペンの設定',
  pdfDrawTool: 'ツール',
  pdfDrawPen: 'ペン',
  pdfDrawRect: '四角形',
  pdfDrawEllipse: '楕円',
  pdfDrawLine: '線',
  pdfDrawArrow: '矢印',
  pdfDrawEraser: '消しゴム',
  pdfDrawColor: '色',
  pdfDrawColorRed: '赤',
  pdfDrawColorYellow: '黄',
  pdfDrawColorGreen: '緑',
  pdfDrawColorBlue: '青',
  pdfDrawColorBlack: '黒',
  pdfDrawWidth: '太さ',
  pdfDrawWidthValue: '{width} pt',
  pdfDrawFinger: '指でも描く',
  pdfDrawFingerHint:
    'オンにすると、ペンを使った後も指で描けます。オフのときは、ペンを使った後は指で画面を動かします。',
  pdfDrawEraserHint: '消しゴムで消せるのは、まだ保存していない線と図形だけです。',
  pdfDrawRefused: '今は描けません。しばらくしてからもう一度お試しください。',
} as const satisfies Record<keyof typeof zh, string>
