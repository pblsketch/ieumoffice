import type { zh } from './zh'

export const es = {
  sheetsAiUndoRefused:
    'La hoja se editó después de los cambios de la IA, así que no se deshicieron.',
  sheetsAiUndoPartial: 'Algunos cambios de la IA no se pudieron deshacer. Revisa la hoja.',
  sheetsAiUndoExpired:
    'Los cambios de la IA ya no se pueden deshacer de una vez (el libro se guardó o se editó mucho después). Usa Deshacer.',
} as const satisfies Record<keyof typeof zh, string>
