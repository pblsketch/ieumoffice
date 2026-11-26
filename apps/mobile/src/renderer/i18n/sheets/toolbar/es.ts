import type { zh } from './zh'

export const es = {
  sheetsToolbarFormat: 'Formato de celda',
  sheetsToolbarRows: 'Filas y columnas',
  sheetsToolbarSort: 'Ordenar y filtrar',
  sheetsToolbarInsert: 'Insertar',
  sheetsToolbarInsertValues: 'Fechas y hojas',
  sheetsToolbarToday: 'Fecha de hoy',
  sheetsToolbarTimeNow: 'Hora actual',
  sheetsToolbarNewSheet: 'Hoja nueva',
  sheetsToolbarFind: 'Buscar',
  sheetsToolbarViewOnly:
    'Los gráficos, las tablas dinámicas y el formato condicional solo se pueden ver aquí. Abra el archivo en un ordenador para cambiarlos.',
  sheetsToolbarFullLoaded: 'Se cargó todo el libro. Vuelva a tocar ordenar o filtrar.',
} as const satisfies Record<keyof typeof zh, string>
