import type { zh } from './zh'

export const es = {
  sheetsProvisionalNotice: 'Cuadrícula de prueba: tus cambios aún no se guardan.',
  sheetsLoading: 'Cargando la cuadrícula…',
  sheetsShareFailed: 'No se pudo compartir este archivo.',
  sheetsFreezeTopRow: 'Inmovilizar fila superior',
  sheetsFreezeFirstColumn: 'Inmovilizar primera columna',
  sheetsUnfreeze: 'Movilizar paneles',
  sheetsKeyboardBar: 'Herramientas para fórmulas',
  sheetsInsertSum: 'Función suma',
  sheetsInsertParens: 'Paréntesis',
  sheetsNumericKeys: 'Teclado numérico',
  sheetsCancelEdit: 'Cancelar',
  sheetsConfirmEdit: 'Aceptar',
} as const satisfies Record<keyof typeof zh, string>
