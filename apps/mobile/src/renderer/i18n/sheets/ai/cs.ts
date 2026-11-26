import type { zh } from './zh'

export const cs = {
  sheetsAiUndoRefused: 'List byl po změnách AI upraven, proto nebyly vráceny.',
  sheetsAiUndoPartial: 'Některé změny AI se nepodařilo vrátit. Zkontrolujte list.',
  sheetsAiUndoExpired:
    'Změny AI už nelze vrátit jedním krokem (sešit byl mezitím uložen nebo hodně upraven). Použijte Zpět.',
} as const satisfies Record<keyof typeof zh, string>
