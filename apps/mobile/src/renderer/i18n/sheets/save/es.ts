import type { zh } from './zh'

export const es = {
  sheetsShareFailed: 'No se pudo compartir este archivo.',
  sheetsSaveFailed: 'No se pudo guardar. El archivo original no ha cambiado.',
  sheetsSaveAsTitle: 'Guardar como',
  sheetsShareTitle: 'Compartir como',
  sheetsFormatWorkbook: 'Libro de Excel (.xlsx)',
  sheetsFormatWorkbookMacro: 'Libro de Excel habilitado para macros (.xlsm)',
  sheetsFormatCsv: 'CSV (solo la hoja actual)',
  sheetsFormatOds: 'Hoja de cálculo ODS (copia del libro)',
  sheetsFormatPdf: 'PDF (hoja actual)',
  sheetsOdsEncrypted: 'Un libro con contraseña no se puede exportar como ODS.',
  sheetsChoiceCancel: 'Cancelar',
  sheetsCsvAskTitle: 'Guardar archivo CSV',
  sheetsCsvAskMessage: 'Un archivo CSV solo guarda los valores de la hoja actual.',
  sheetsCsvAskCsv: 'Guardar como CSV (sin formato ni otras hojas)',
  sheetsCsvAskXlsx: 'Guardar como archivo de Excel',
  sheetsCsvFormulaTitle: 'Las fórmulas solo conservan sus valores',
  sheetsCsvFormulaMessage:
    'Las fórmulas de esta hoja se guardan en CSV solo como valores calculados. Para conservar las fórmulas, guarda como archivo de Excel.',
  sheetsCsvContinue: 'Continuar como CSV',
  sheetsOdsLossTitle: 'Exportar como ODS',
  sheetsOdsLossMessage:
    '{count} funciones que ODS no admite (fórmulas, gráficos, imágenes, formato condicional, etc.) no se incluyen en la copia.',
  sheetsOdsContinue: 'Continuar',
  sheetsOdsUnreadable: 'No se pudo volver a abrir el archivo ODS, así que no se escribió.',
  sheetsOdsFailed: 'No se pudo exportar como ODS.',
  sheetsCopySaved: 'Copia guardada: {name}',
  sheetsPdfWorking: 'Creando el PDF…',
  sheetsPdfFailed: 'No se pudo crear el PDF.',
  sheetsPdfSkippedVisuals: 'No se pudieron incluir {count} imágenes o gráficos en el PDF.',
  sheetsPdfMissingGlyphs:
    '{count} caracteres que no están en las fuentes aparecen como cuadros vacíos en el PDF.',
  sheetsSaveErrDiskChanged:
    'Otra aplicación cambió el original después de abrirlo. No se sobrescribió; usa Guardar como.',
  sheetsSaveErrTooLarge:
    'El archivo es demasiado grande (más de unos 14 MB) para escribirlo en este teléfono. El original no ha cambiado.',
  sheetsSaveErrUnreadable:
    'No se pudo volver a abrir el libro guardado, así que el original quedó como estaba.',
  sheetsSaveErrLockFailed:
    'No se pudo volver a bloquear el libro con su contraseña, así que el original quedó como estaba.',
  sheetsSaveBusy: 'Se está guardando. Inténtalo de nuevo cuando termine.',
} as const satisfies Record<keyof typeof zh, string>
