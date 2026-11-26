import type { zh } from './zh'

export const de = {
  sheetsAiUndoRefused:
    'Das Blatt wurde nach den Änderungen der KI bearbeitet, daher wurden sie nicht rückgängig gemacht.',
  sheetsAiUndoPartial:
    'Einige Änderungen der KI konnten nicht rückgängig gemacht werden. Bitte prüfen Sie das Blatt.',
  sheetsAiUndoExpired:
    'Die Änderungen der KI lassen sich nicht mehr in einem Schritt rückgängig machen (die Mappe wurde seitdem gespeichert oder stark bearbeitet). Verwenden Sie Rückgängig.',
} as const satisfies Record<keyof typeof zh, string>
