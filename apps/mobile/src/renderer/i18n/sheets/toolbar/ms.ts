import type { zh } from './zh'

export const ms = {
  sheetsToolbarFormat: 'Format sel',
  sheetsToolbarRows: 'Baris & lajur',
  sheetsToolbarSort: 'Isih & tapis',
  sheetsToolbarInsert: 'Sisip',
  sheetsToolbarInsertValues: 'Tarikh dan helaian',
  sheetsToolbarToday: 'Tarikh hari ini',
  sheetsToolbarTimeNow: 'Masa sekarang',
  sheetsToolbarNewSheet: 'Helaian baharu',
  sheetsToolbarFind: 'Cari',
  sheetsToolbarViewOnly:
    'Carta, jadual pangsi dan pemformatan bersyarat hanya boleh dilihat di sini. Buka fail pada komputer untuk mengubahnya.',
  sheetsToolbarFullLoaded: 'Seluruh buku kerja telah dimuatkan. Ketik isih atau tapis sekali lagi.',
} as const satisfies Record<keyof typeof zh, string>
