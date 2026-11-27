import type { zh } from './zh'

export const id = {
  staleDialogTitle: 'Ada item yang perlu diperbarui',
  staleDialogBody:
    'Item berikut mungkin sudah tidak mutakhir setelah perubahan terbaru. Perbarui sebelum melanjutkan?',
  staleActionSave: 'Simpan',
  staleActionPrint: 'Cetak',
  staleActionPdf: 'Ekspor PDF',
  staleActionSubmission: 'Simpan salinan penyerahan',
  staleBtnRefreshAll: 'Perbarui semua',
  staleBtnContinue: 'Lanjutkan saja',
  staleBtnCancel: 'Batal',
  staleReasonPagesChanged: 'Nomor halaman berubah',
  staleReasonEntriesChanged: 'Entri berubah',
  staleKindTocBody: 'Daftar isi',
  staleKindTocTable: 'Daftar tabel',
  staleKindTocFigure: 'Daftar gambar',
  staleKindTocEquation: 'Daftar persamaan',
  staleKindIndex: 'Indeks',
  staleKindBibliography: 'Daftar pustaka',
  staleManualConfirmTitle: 'Suntingan manual terdeteksi',
  staleManualConfirmBody:
    'Suntingan manual ditemukan pada: {items}. Timpa dan tetap perbarui?',
  staleManualOverwrite: 'Timpa dan perbarui',
  staleManualSkip: 'Lewati',
  staleRefreshDone: '{count} item diperbarui.',
  staleRefreshFailed: 'Sebagian item tidak dapat diperbarui: {error}',
  submissionMenuLabel: 'Simpan sebagai Salinan Penyerahan…',
  submissionMenuDesc:
    'Simpan salinan bersih terpisah tanpa penanda indeks, kutipan, atau pengaturan.',
  submissionSaving: 'Membuat salinan penyerahan…',
  submissionSaved: 'Salinan penyerahan disimpan: {name}',
  submissionSavedTailsLost:
    'Salinan penyerahan disimpan ({name}). Beberapa halaman master atau komentar mungkin tidak tersimpan.',
  submissionFailedProtected:
    'Dokumen yang dilindungi kata sandi tidak dapat disimpan sebagai salinan penyerahan.',
  submissionFailedTracked:
    'Dokumen dengan pelacakan perubahan tidak dapat disimpan sebagai salinan penyerahan.',
  submissionFailedVerify:
    'Verifikasi salinan penyerahan gagal ({before} → {after} halaman). Coba simpan dalam format HWPX.',
  submissionFailedExport: 'Gagal membuat salinan penyerahan: {error}',
  submissionFailedWrite: 'Gagal menyimpan salinan penyerahan: {error}',
} satisfies Record<keyof typeof zh, string>
