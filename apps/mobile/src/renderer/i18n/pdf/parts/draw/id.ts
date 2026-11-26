import type { zh } from './zh'

export const id = {
  pdfDrawSettings: 'Pengaturan pena',
  pdfDrawTool: 'Alat',
  pdfDrawPen: 'Pena',
  pdfDrawRect: 'Persegi panjang',
  pdfDrawEllipse: 'Elips',
  pdfDrawLine: 'Garis',
  pdfDrawArrow: 'Panah',
  pdfDrawEraser: 'Penghapus',
  pdfDrawColor: 'Warna',
  pdfDrawColorRed: 'Merah',
  pdfDrawColorYellow: 'Kuning',
  pdfDrawColorGreen: 'Hijau',
  pdfDrawColorBlue: 'Biru',
  pdfDrawColorBlack: 'Hitam',
  pdfDrawWidth: 'Ketebalan',
  pdfDrawWidthValue: '{width} pt',
  pdfDrawFinger: 'Menggambar juga dengan jari',
  pdfDrawFingerHint:
    'Jika aktif, jari tetap menggambar setelah pena digunakan. Jika nonaktif, setelah pena digunakan jari menggeser halaman.',
  pdfDrawEraserHint: 'Penghapus hanya menghapus goresan dan bentuk yang belum disimpan.',
  pdfDrawRefused: 'Tidak dapat menggambar sekarang. Coba lagi sebentar lagi.',
} as const satisfies Record<keyof typeof zh, string>
