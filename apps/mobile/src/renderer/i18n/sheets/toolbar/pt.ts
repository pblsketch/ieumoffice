import type { zh } from './zh'

export const pt = {
  sheetsToolbarFormat: 'Formato da célula',
  sheetsToolbarRows: 'Linhas e colunas',
  sheetsToolbarSort: 'Classificar e filtrar',
  sheetsToolbarInsert: 'Inserir',
  sheetsToolbarInsertValues: 'Datas e planilhas',
  sheetsToolbarToday: 'Data de hoje',
  sheetsToolbarTimeNow: 'Hora atual',
  sheetsToolbarNewSheet: 'Nova planilha',
  sheetsToolbarFind: 'Localizar',
  sheetsToolbarViewOnly:
    'Gráficos, tabelas dinâmicas e formatação condicional aqui são só para visualizar. Abra o arquivo em um computador para alterá-los.',
  sheetsToolbarFullLoaded:
    'A pasta de trabalho inteira foi carregada. Toque em classificar ou filtrar de novo.',
} as const satisfies Record<keyof typeof zh, string>
