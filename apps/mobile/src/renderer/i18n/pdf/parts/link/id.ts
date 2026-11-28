import type { zh } from './zh'

export const id = {
  pdfLinkPlaceHint: 'Seret kotak di halaman tempat tautan diletakkan',
  pdfLinkEditTitle: 'Edit tautan',
  pdfLinkUrlLabel: 'Alamat web (http, https, mailto)',
  pdfLinkPageLabel: 'Atau halaman dalam dokumen ini (1–{count})',
  pdfLinkUrlInvalid: 'Hanya alamat http, https, dan mailto yang dapat ditautkan',
  pdfLinkPageInvalid: 'Masukkan nomor halaman dari 1 sampai {count}',
  pdfLinkNeedTarget: 'Masukkan alamat web atau nomor halaman',
  pdfLinkApply: 'Tambah tautan',
  pdfLinkDelete: 'Hapus tautan',
  pdfLinkPending: 'Tautan yang akan ditambahkan: {target}',
  pdfLinkToPage: 'Halaman {page}',
  pdfLinkFailed: 'Tautan tidak dapat diubah. Coba lagi setelah penyimpanan selesai.',
  pdfLinkUpdate: 'Terapkan',
} as const satisfies Record<keyof typeof zh, string>
