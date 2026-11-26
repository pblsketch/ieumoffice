import type { zh } from './zh'

export const ms = {
  sheetsShareFailed: 'Tidak dapat berkongsi fail ini.',
  sheetsSaveFailed: 'Tidak dapat menyimpan. Fail asal tidak berubah.',
  sheetsSaveAsTitle: 'Simpan Sebagai',
  sheetsShareTitle: 'Kongsi sebagai',
  sheetsFormatWorkbook: 'Buku kerja Excel (.xlsx)',
  sheetsFormatWorkbookMacro: 'Buku kerja Excel dengan makro (.xlsm)',
  sheetsFormatCsv: 'CSV (helaian semasa sahaja)',
  sheetsFormatOds: 'Hamparan ODS (salinan buku kerja)',
  sheetsFormatPdf: 'PDF (helaian semasa)',
  sheetsOdsEncrypted: 'Buku kerja berkata laluan tidak boleh dieksport sebagai ODS.',
  sheetsChoiceCancel: 'Batal',
  sheetsCsvAskTitle: 'Simpan fail CSV',
  sheetsCsvAskMessage: 'Fail CSV hanya menyimpan nilai helaian semasa.',
  sheetsCsvAskCsv: 'Simpan sebagai CSV (tanpa format dan helaian lain)',
  sheetsCsvAskXlsx: 'Simpan sebagai fail Excel',
  sheetsCsvFormulaTitle: 'Formula hanya menyimpan nilainya',
  sheetsCsvFormulaMessage:
    'Formula helaian ini hanya disimpan sebagai nilai yang dikira dalam CSV. Untuk mengekalkan formula, simpan sebagai fail Excel.',
  sheetsCsvContinue: 'Teruskan sebagai CSV',
  sheetsOdsLossTitle: 'Eksport sebagai ODS',
  sheetsOdsLossMessage:
    '{count} ciri yang tidak dapat dimuatkan oleh ODS (formula, carta, gambar, pemformatan bersyarat dan seumpamanya) tidak disertakan dalam salinan.',
  sheetsOdsContinue: 'Teruskan',
  sheetsOdsUnreadable: 'Fail ODS tidak dapat dibuka semula, jadi ia tidak ditulis.',
  sheetsOdsFailed: 'Tidak dapat mengeksport sebagai ODS.',
  sheetsCopySaved: 'Salinan disimpan: {name}',
  sheetsPdfWorking: 'Membuat PDF…',
  sheetsPdfFailed: 'Tidak dapat membuat PDF.',
  sheetsPdfSkippedVisuals: '{count} gambar atau carta tidak dapat dimasukkan ke dalam PDF.',
  sheetsPdfMissingGlyphs:
    '{count} aksara yang tiada dalam fon dipaparkan sebagai kotak kosong dalam PDF.',
  sheetsSaveErrDiskChanged:
    'Aplikasi lain menukar fail asal selepas ia dibuka. Ia tidak ditulis ganti; gunakan Simpan Sebagai.',
  sheetsSaveErrTooLarge:
    'Fail terlalu besar (melebihi kira-kira 14 MB) untuk ditulis pada telefon ini. Fail asal tidak berubah.',
  sheetsSaveErrUnreadable:
    'Buku kerja yang disimpan tidak dapat dibuka semula, jadi fail asal dibiarkan seperti sedia ada.',
  sheetsSaveErrLockFailed:
    'Buku kerja tidak dapat dikunci semula dengan kata laluannya, jadi fail asal dibiarkan seperti sedia ada.',
  sheetsSaveBusy: 'Sedang menyimpan. Cuba lagi selepas selesai.',
} as const satisfies Record<keyof typeof zh, string>
