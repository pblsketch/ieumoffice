import type { zh } from './zh'

export const pt = {
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
