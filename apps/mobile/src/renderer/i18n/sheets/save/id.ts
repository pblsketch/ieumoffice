import type { zh } from './zh'

export const id = {
  sheetsShareFailed: 'Tidak dapat membagikan file ini.',
  sheetsSaveFailed: 'Tidak dapat menyimpan. File asli tidak berubah.',
  sheetsSaveAsTitle: 'Simpan Sebagai',
  sheetsShareTitle: 'Bagikan sebagai',
  sheetsFormatWorkbook: 'Buku kerja Excel (.xlsx)',
  sheetsFormatWorkbookMacro: 'Buku kerja Excel dengan makro (.xlsm)',
  sheetsFormatCsv: 'CSV (hanya lembar saat ini)',
  sheetsFormatOds: 'Spreadsheet ODS (salinan buku kerja)',
  sheetsFormatPdf: 'PDF (lembar saat ini)',
  sheetsOdsEncrypted: 'Buku kerja berkata sandi tidak dapat diekspor sebagai ODS.',
  sheetsChoiceCancel: 'Batal',
  sheetsCsvAskTitle: 'Simpan file CSV',
  sheetsCsvAskMessage: 'File CSV hanya menyimpan nilai lembar saat ini.',
  sheetsCsvAskCsv: 'Simpan sebagai CSV (format dan lembar lain tidak ikut)',
  sheetsCsvAskXlsx: 'Simpan sebagai file Excel',
  sheetsCsvFormulaTitle: 'Rumus hanya menyimpan nilainya',
  sheetsCsvFormulaMessage:
    'Rumus di lembar ini hanya disimpan sebagai nilai hasil hitung dalam CSV. Untuk menyimpan rumus, simpan sebagai file Excel.',
  sheetsCsvContinue: 'Lanjutkan sebagai CSV',
  sheetsOdsLossTitle: 'Ekspor sebagai ODS',
  sheetsOdsLossMessage:
    '{count} fitur yang tidak dapat ditampung ODS (rumus, bagan, gambar, format bersyarat, dan sejenisnya) tidak ikut dalam salinan.',
  sheetsOdsContinue: 'Lanjutkan',
  sheetsOdsUnreadable: 'File ODS tidak dapat dibuka lagi, jadi tidak ditulis.',
  sheetsOdsFailed: 'Tidak dapat mengekspor sebagai ODS.',
  sheetsCopySaved: 'Salinan disimpan: {name}',
  sheetsPdfWorking: 'Membuat PDF…',
  sheetsPdfFailed: 'Tidak dapat membuat PDF.',
  sheetsPdfSkippedVisuals: '{count} gambar atau bagan tidak dapat dimasukkan ke PDF.',
  sheetsPdfMissingGlyphs:
    '{count} karakter yang tidak ada di font tampil sebagai kotak kosong di PDF.',
  sheetsSaveErrDiskChanged:
    'Aplikasi lain mengubah file asli setelah dibuka. File tidak ditimpa; gunakan Simpan Sebagai.',
  sheetsSaveErrTooLarge:
    'File terlalu besar (lebih dari sekitar 14 MB) untuk ditulis di ponsel ini. File asli tidak berubah.',
  sheetsSaveErrUnreadable:
    'Buku kerja yang disimpan tidak dapat dibuka lagi, jadi file asli dibiarkan apa adanya.',
  sheetsSaveErrLockFailed:
    'Buku kerja tidak dapat dikunci lagi dengan kata sandinya, jadi file asli dibiarkan apa adanya.',
  sheetsSaveBusy: 'Sedang menyimpan. Coba lagi setelah selesai.',
} as const satisfies Record<keyof typeof zh, string>
