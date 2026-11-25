import type { zh } from './zh'

export const pt = {
  sheetsProvisionalNotice: 'Grade de teste: suas alterações ainda não são salvas.',
  sheetsLoading: 'Carregando a grade…',
  sheetsShareFailed: 'Não foi possível compartilhar este arquivo.',
  sheetsFreezeTopRow: 'Congelar linha superior',
  sheetsFreezeFirstColumn: 'Congelar primeira coluna',
  sheetsUnfreeze: 'Descongelar painéis',
  sheetsKeyboardBar: 'Ferramentas de fórmula',
  sheetsInsertSum: 'Função soma',
  sheetsInsertParens: 'Parênteses',
  sheetsNumericKeys: 'Teclado numérico',
  sheetsCancelEdit: 'Cancelar',
  sheetsConfirmEdit: 'Concluir',
} as const satisfies Record<keyof typeof zh, string>
