import type { zh } from './zh'

export const id = {
  sheetsToolbarFormat: 'Format sel',
  sheetsToolbarRows: 'Baris & kolom',
  sheetsToolbarSort: 'Urutkan & filter',
  sheetsToolbarInsert: 'Sisipkan',
  sheetsToolbarInsertValues: 'Tanggal dan lembar',
  sheetsToolbarToday: 'Tanggal hari ini',
  sheetsToolbarTimeNow: 'Waktu sekarang',
  sheetsToolbarNewSheet: 'Lembar baru',
  sheetsToolbarFind: 'Cari',
  sheetsToolbarViewOnly:
    'Bagan, tabel pivot, dan pemformatan bersyarat hanya bisa dilihat di sini. Buka file di komputer untuk mengubahnya.',
  sheetsToolbarFullLoaded: 'Seluruh buku kerja sudah dimuat. Ketuk urutkan atau filter lagi.',
} as const satisfies Record<keyof typeof zh, string>
