import type { zh } from './zh'

export const ms = {
  pdfPagesSelected: '{n} dipilih',
  pdfPagesNoneSelected: 'Ketik halaman untuk memilihnya',
  pdfPagesSelectAll: 'Pilih semua',
  pdfPagesClearSelection: 'Kosongkan pilihan',
  pdfPagesRotate: 'Putar',
  pdfPagesDelete: 'Padam',
  pdfPagesMoveEarlier: 'Lebih awal',
  pdfPagesMoveLater: 'Lebih lewat',
  pdfPagesBlankBefore: 'Halaman kosong sebelum',
  pdfPagesBlankAfter: 'Halaman kosong selepas',
  pdfPagesImport: 'Daripada PDF lain',
  pdfPagesPageLabel: 'Halaman {n}',
  pdfPagesBlankLabel: 'Halaman kosong',
  pdfPagesDragHandle: 'Seret untuk mengalihkan',
  pdfPagesKeepOne: 'Halaman terakhir tidak boleh dipadam.',
  pdfPagesActionFailed: 'Tidak dapat menukar halaman.',
  pdfPagesDeletedLabel: 'Akan dipadam',
  pdfPagesDeletedHint: 'Dipadam apabila disimpan. Buat asal untuk memulihkannya.',
  pdfPagesMovedLabel: 'Susunan baharu: halaman {n}',
  pdfPagesImportTitle: 'Sisipkan halaman daripada PDF lain',
  pdfPagesImportCount: 'Halaman untuk disisipkan: {n}',
  pdfPagesImportPlace: 'Tempat menyisip',
  pdfPagesImportFront: 'Di permulaan',
  pdfPagesImportAfter: 'Selepas halaman {n}',
  pdfPagesImportEnd: 'Di penghujung',
  pdfPagesImportConfirmHint:
    'Perubahan anda setakat ini disimpan dahulu, kemudian halaman disisipkan. Halaman yang disisipkan terus ditulis ke dalam fail dan tidak boleh dibuat asal.',
  pdfPagesImportConfirm: 'Simpan dan sisipkan',
  pdfPagesImportDone: '{n} halaman disisipkan.',
  pdfPagesImportFailed: 'Tidak dapat menyisipkan halaman.',
  pdfPagesImportDamaged:
    'Halaman daripada PDF lain tidak boleh disisipkan ke dalam dokumen yang rosak.',
  pdfPagesImportEncrypted:
    'Halaman daripada PDF lain tidak boleh disisipkan ke dalam dokumen yang disulitkan.',
  pdfPagesImportUntitled:
    'Halaman tidak boleh disisipkan ke dalam dokumen baharu yang belum pernah disimpan. Simpan dahulu.',
  pdfPagesImportReadOnly: 'Halaman tidak boleh disisipkan ke dalam dokumen baca sahaja.',
  pdfPagesImportPickEncrypted:
    'PDF yang dipilih dilindungi kata laluan, jadi halamannya tidak boleh diimport.',
  pdfPagesImportPickUnreadable: 'Fail yang dipilih tidak dapat dibaca sebagai PDF.',
} as const satisfies Record<keyof typeof zh, string>
