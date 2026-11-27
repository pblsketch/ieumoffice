import type { zh } from './zh'

export const ms = {
  staleDialogTitle: 'Item perlu dikemas kini',
  staleDialogBody:
    'Item berikut mungkin tidak lagi terkini selepas suntingan terbaharu. Segarkan semula sebelum meneruskan?',
  staleActionSave: 'Simpan',
  staleActionPrint: 'Cetak',
  staleActionPdf: 'Eksport PDF',
  staleActionSubmission: 'Simpan salinan serahan',
  staleBtnRefreshAll: 'Segarkan semua',
  staleBtnContinue: 'Teruskan juga',
  staleBtnCancel: 'Batal',
  staleReasonPagesChanged: 'Nombor halaman berubah',
  staleReasonEntriesChanged: 'Entri berubah',
  staleKindTocBody: 'Isi kandungan',
  staleKindTocTable: 'Senarai jadual',
  staleKindTocFigure: 'Senarai rajah',
  staleKindTocEquation: 'Senarai persamaan',
  staleKindIndex: 'Indeks',
  staleKindBibliography: 'Bibliografi',
  staleManualConfirmTitle: 'Suntingan manual dikesan',
  staleManualConfirmBody: 'Suntingan manual ditemui dalam: {items}. Tulis ganti dan segarkan?',
  staleManualOverwrite: 'Tulis ganti dan segarkan',
  staleManualSkip: 'Langkau',
  staleRefreshDone: '{count} item dikemas kini.',
  staleRefreshFailed: 'Sebahagian item gagal dikemas kini: {error}',
  staleRefreshBlockedObjects:
    'Segar semula dilangkau kerana julat isi kandungan atau indeks mengandungi objek pengguna seperti nota kaki, gambar atau jadual.',
  submissionMenuLabel: 'Simpan sebagai Salinan Serahan…',
  submissionMenuDesc:
    'Simpan salinan bersih berasingan tanpa penanda indeks, petikan, atau tetapan.',
  submissionSaving: 'Menjana salinan serahan…',
  submissionSaved: 'Salinan serahan disimpan: {name}',
  submissionBackupKept: 'Sandaran fail terdahulu disimpan sebagai: {name}',
  submissionSavedTailsLost:
    'Salinan serahan disimpan ({name}). Sesetengah halaman induk atau komen mungkin tidak dapat dikekalkan.',
  submissionFailedProtected:
    'Dokumen dilindungi kata laluan tidak boleh disimpan sebagai salinan serahan.',
  submissionFailedTracked:
    'Dokumen dengan jejak perubahan tidak boleh disimpan sebagai salinan serahan.',
  submissionFailedSameAsOpen:
    'Dokumen yang sedang dibuka tidak boleh ditulis ganti dengan salinan serahan. Sila pilih nama fail lain.',
  submissionFailedStrip:
    'Salinan serahan tidak disimpan kerana sebahagian penanda dalaman gagal dialih keluar: {marks}',
  submissionFailedVerify:
    'Pengesahan salinan serahan gagal ({before} → {after} halaman). Cuba simpan dalam format HWPX.',
  submissionFailedExport: 'Gagal menjana salinan serahan: {error}',
  submissionFailedWrite: 'Gagal menyimpan salinan serahan: {error}',
} satisfies Record<keyof typeof zh, string>
