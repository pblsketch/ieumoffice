import type { zh } from './zh'

export const ms = {
  pdfDrawSettings: 'Tetapan pen',
  pdfDrawTool: 'Alat',
  pdfDrawPen: 'Pen',
  pdfDrawRect: 'Segi empat',
  pdfDrawEllipse: 'Elips',
  pdfDrawLine: 'Garisan',
  pdfDrawArrow: 'Anak panah',
  pdfDrawEraser: 'Pemadam',
  pdfDrawColor: 'Warna',
  pdfDrawColorRed: 'Merah',
  pdfDrawColorYellow: 'Kuning',
  pdfDrawColorGreen: 'Hijau',
  pdfDrawColorBlue: 'Biru',
  pdfDrawColorBlack: 'Hitam',
  pdfDrawWidth: 'Ketebalan',
  pdfDrawWidthValue: '{width} pt',
  pdfDrawFinger: 'Lukis dengan jari juga',
  pdfDrawFingerHint:
    'Apabila dihidupkan, jari masih melukis selepas pen digunakan. Apabila dimatikan, selepas pen digunakan jari menggerakkan halaman.',
  pdfDrawEraserHint: 'Pemadam hanya membuang lakaran dan bentuk yang belum disimpan.',
  pdfDrawRefused: 'Tidak dapat melukis sekarang. Cuba lagi sebentar lagi.',
} as const satisfies Record<keyof typeof zh, string>
