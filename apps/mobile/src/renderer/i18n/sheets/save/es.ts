import type { zh } from './zh'

export const es = {
  sheetsShareFailed: 'No se pudo compartir este archivo.',
  sheetsSaveFailed: 'No se pudo guardar. El archivo original no ha cambiado.',
  sheetsSaveNotYet: 'Este libro aún no se puede guardar en el teléfono.',
} as const satisfies Record<keyof typeof zh, string>
