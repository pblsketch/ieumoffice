import type { zh } from './zh'

export const tr = {
  pdfDrawSettings: 'Kalem ayarları',
  pdfDrawTool: 'Araç',
  pdfDrawPen: 'Kalem',
  pdfDrawRect: 'Dikdörtgen',
  pdfDrawEllipse: 'Elips',
  pdfDrawLine: 'Çizgi',
  pdfDrawArrow: 'Ok',
  pdfDrawEraser: 'Silgi',
  pdfDrawColor: 'Renk',
  pdfDrawColorRed: 'Kırmızı',
  pdfDrawColorYellow: 'Sarı',
  pdfDrawColorGreen: 'Yeşil',
  pdfDrawColorBlue: 'Mavi',
  pdfDrawColorBlack: 'Siyah',
  pdfDrawWidth: 'Kalınlık',
  pdfDrawWidthValue: '{width} pt',
  pdfDrawFinger: 'Parmakla da çiz',
  pdfDrawFingerHint:
    'Açıkken kalem kullandıktan sonra da parmak çizer. Kapalıyken kalem kullandıktan sonra parmak sayfayı kaydırır.',
  pdfDrawEraserHint: 'Silgi yalnızca henüz kaydedilmemiş çizgileri ve şekilleri siler.',
  pdfDrawRefused: 'Şu anda çizilemiyor. Birazdan yeniden deneyin.',
} as const satisfies Record<keyof typeof zh, string>
