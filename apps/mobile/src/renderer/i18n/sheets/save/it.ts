import type { zh } from './zh'

export const it = {
  sheetsShareFailed: 'Impossibile condividere questo file.',
  sheetsSaveFailed: 'Impossibile salvare. Il file originale non è cambiato.',
  sheetsSaveNotYet: 'Questa cartella di lavoro non può ancora essere salvata sul telefono.',
} as const satisfies Record<keyof typeof zh, string>
