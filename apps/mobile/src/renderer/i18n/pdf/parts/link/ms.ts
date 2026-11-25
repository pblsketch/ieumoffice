import type { zh } from './zh'

export const ms = {
  pdfLinkPlaceHint: 'Seret kotak pada halaman di tempat pautan diletakkan',
  pdfLinkEditTitle: 'Edit pautan',
  pdfLinkUrlLabel: 'Alamat web (http, https, mailto)',
  pdfLinkPageLabel: 'Atau halaman dalam dokumen ini (1–{count})',
  pdfLinkUrlInvalid: 'Hanya alamat http, https dan mailto boleh dipautkan',
  pdfLinkPageInvalid: 'Masukkan nombor halaman dari 1 hingga {count}',
  pdfLinkNeedTarget: 'Masukkan alamat web atau nombor halaman',
  pdfLinkApply: 'Tambah pautan',
  pdfLinkDelete: 'Padam pautan',
  pdfLinkPending: 'Pautan yang akan ditambah: {target}',
  pdfLinkToPage: 'Halaman {page}',
  pdfLinkFailed: 'Pautan tidak dapat diubah. Cuba lagi selepas simpanan selesai.',
  pdfLinkUpdate: 'Guna',
} as const satisfies Record<keyof typeof zh, string>
