import type { zh } from './zh'

export const ms = {
  sheetsAiUndoRefused: 'Helaian telah disunting selepas perubahan AI, jadi ia tidak dibuat asal.',
  sheetsAiUndoPartial: 'Sebahagian perubahan AI tidak dapat dibuat asal. Sila semak helaian.',
  sheetsAiUndoExpired:
    'Perubahan AI tidak lagi boleh dibuat asal sekali gus (buku kerja telah disimpan atau banyak disunting selepas itu). Gunakan Buat Asal.',
} as const satisfies Record<keyof typeof zh, string>
