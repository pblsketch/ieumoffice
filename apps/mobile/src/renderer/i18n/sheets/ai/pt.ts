import type { zh } from './zh'

export const pt = {
  sheetsAiUndoRefused:
    'A planilha foi editada depois das alterações da IA, então elas não foram desfeitas.',
  sheetsAiUndoPartial: 'Algumas alterações da IA não puderam ser desfeitas. Verifique a planilha.',
  sheetsAiUndoExpired:
    'As alterações da IA não podem mais ser desfeitas de uma vez (a pasta foi salva ou muito editada depois). Use Desfazer.',
} as const satisfies Record<keyof typeof zh, string>
