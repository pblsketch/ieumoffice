import type { zh } from './zh'

export const pt = {
  sheetsShareFailed: 'Não foi possível compartilhar este arquivo.',
  sheetsSaveFailed: 'Não foi possível salvar. O arquivo original não foi alterado.',
  sheetsSaveAsTitle: 'Salvar como',
  sheetsShareTitle: 'Compartilhar como',
  sheetsFormatWorkbook: 'Pasta de trabalho do Excel (.xlsx)',
  sheetsFormatWorkbookMacro: 'Pasta de trabalho do Excel habilitada para macro (.xlsm)',
  sheetsFormatCsv: 'CSV (somente a planilha atual)',
  sheetsFormatOds: 'Planilha ODS (cópia da pasta de trabalho)',
  sheetsFormatPdf: 'PDF (planilha atual)',
  sheetsOdsEncrypted: 'Uma pasta de trabalho com senha não pode ser exportada como ODS.',
  sheetsChoiceCancel: 'Cancelar',
  sheetsCsvAskTitle: 'Salvar arquivo CSV',
  sheetsCsvAskMessage: 'Um arquivo CSV guarda apenas os valores da planilha atual.',
  sheetsCsvAskCsv: 'Salvar como CSV (sem formatação e outras planilhas)',
  sheetsCsvAskXlsx: 'Salvar como arquivo do Excel',
  sheetsCsvFormulaTitle: 'As fórmulas guardam só os valores',
  sheetsCsvFormulaMessage:
    'As fórmulas desta planilha ficam no CSV apenas como valores calculados. Para manter as fórmulas, salve como arquivo do Excel.',
  sheetsCsvContinue: 'Continuar como CSV',
  sheetsOdsLossTitle: 'Exportar como ODS',
  sheetsOdsLossMessage:
    '{count} recursos que o ODS não comporta (fórmulas, gráficos, imagens, formatação condicional etc.) ficam fora da cópia.',
  sheetsOdsContinue: 'Continuar',
  sheetsOdsUnreadable:
    'Não foi possível abrir o arquivo ODS de novo, por isso ele não foi gravado.',
  sheetsOdsFailed: 'Não foi possível exportar como ODS.',
  sheetsCopySaved: 'Cópia salva: {name}',
  sheetsPdfWorking: 'Criando o PDF…',
  sheetsPdfFailed: 'Não foi possível criar o PDF.',
  sheetsPdfSkippedVisuals: 'Não foi possível colocar {count} imagens ou gráficos no PDF.',
  sheetsPdfMissingGlyphs:
    '{count} caracteres ausentes nas fontes aparecem como caixas vazias no PDF.',
  sheetsSaveErrDiskChanged:
    'Outro app alterou o original depois que ele foi aberto. Ele não foi substituído; use Salvar como.',
  sheetsSaveErrTooLarge:
    'O arquivo é grande demais (mais de cerca de 14 MB) para gravar neste celular. O original não mudou.',
  sheetsSaveErrUnreadable:
    'Não foi possível abrir de novo a pasta de trabalho salva, então o original ficou como estava.',
  sheetsSaveErrLockFailed:
    'Não foi possível bloquear de novo a pasta de trabalho com a senha, então o original ficou como estava.',
  sheetsSaveBusy: 'Salvando. Tente de novo quando terminar.',
} as const satisfies Record<keyof typeof zh, string>
