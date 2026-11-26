import type { zh } from './zh'

export const pt = {
  sheetsShareFailed: 'Não foi possível compartilhar este arquivo.',
  sheetsSaveFailed: 'Não foi possível salvar. O arquivo original não foi alterado.',
  sheetsSaveNotYet: 'Esta pasta de trabalho ainda não pode ser salva no telefone.',
} as const satisfies Record<keyof typeof zh, string>
