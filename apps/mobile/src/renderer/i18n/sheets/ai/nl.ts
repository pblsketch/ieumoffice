import type { zh } from './zh'

export const nl = {
  sheetsAiUndoRefused:
    'Het blad is na de wijzigingen van de AI bewerkt, dus ze zijn niet ongedaan gemaakt.',
  sheetsAiUndoPartial:
    'Sommige wijzigingen van de AI konden niet ongedaan worden gemaakt. Controleer het blad.',
  sheetsAiUndoExpired:
    'De wijzigingen van de AI kunnen niet meer in één stap ongedaan worden gemaakt (de werkmap is sindsdien opgeslagen of veel bewerkt). Gebruik Ongedaan maken.',
} as const satisfies Record<keyof typeof zh, string>
