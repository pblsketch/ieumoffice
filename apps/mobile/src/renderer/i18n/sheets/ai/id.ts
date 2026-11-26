import type { zh } from './zh'

export const id = {
  sheetsAiUndoRefused: 'Lembar diedit setelah perubahan AI, jadi perubahan itu tidak dibatalkan.',
  sheetsAiUndoPartial: 'Sebagian perubahan AI tidak dapat dibatalkan. Periksa lembar.',
  sheetsAiUndoExpired:
    'Perubahan AI tidak lagi dapat dibatalkan sekaligus (buku kerja disimpan atau banyak diedit setelahnya). Gunakan Urungkan.',
} as const satisfies Record<keyof typeof zh, string>
