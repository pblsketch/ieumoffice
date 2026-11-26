import type { zh } from './zh'

export const es = {
  webNotUtf8Notice:
    'Este archivo no está en UTF-8, así que no se puede editar. Puedes verlo y compartir el original.',
} as const satisfies Record<keyof typeof zh, string>
