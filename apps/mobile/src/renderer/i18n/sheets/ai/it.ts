import type { zh } from './zh'

export const it = {
  sheetsAiUndoRefused:
    "Il foglio è stato modificato dopo le modifiche dell'IA, quindi non sono state annullate.",
  sheetsAiUndoPartial: "Alcune modifiche dell'IA non sono state annullate. Controlla il foglio.",
  sheetsAiUndoExpired:
    "Le modifiche dell'IA non si possono più annullare in un solo passo (la cartella è stata salvata o molto modificata dopo). Usa Annulla.",
} as const satisfies Record<keyof typeof zh, string>
