import type { zh } from './zh'

export const pl = {
  sheetsAiUndoRefused: 'Arkusz zmieniono po zmianach AI, więc ich nie cofnięto.',
  sheetsAiUndoPartial: 'Części zmian AI nie udało się cofnąć. Sprawdź arkusz.',
  sheetsAiUndoExpired:
    'Zmian AI nie da się już cofnąć jednym krokiem (skoroszyt zapisano lub mocno zmieniono od tamtej pory). Użyj Cofnij.',
} as const satisfies Record<keyof typeof zh, string>
