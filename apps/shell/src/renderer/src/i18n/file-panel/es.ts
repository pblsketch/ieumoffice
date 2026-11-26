import type { zh } from './zh'

export const es = {
  panelTitle: 'Archivos',
  showPanel: 'Mostrar panel de archivos',
  hidePanel: 'Ocultar panel de archivos',
  searchPlaceholder: 'Buscar un archivo',
  sectionCurrent: 'Carpeta de este documento',
  sectionFolders: 'Carpetas',
  sectionRecent: 'Recientes',
  addFolder: 'Añadir carpeta',
  refresh: 'Actualizar',
  collapseAll: 'Contraer todo',
  emptyFolder: 'No hay documentos para abrir aquí',
  folderMissing: 'No se encuentra la carpeta',
  untitledHint:
    'Este documento aún no se ha guardado. Su carpeta aparecerá aquí cuando lo guardes.',
  noResults: 'No hay archivos que coincidan',
  openMark: 'Abierto',
  resizePanel: 'Cambiar el ancho del panel de archivos',
  noRecent: 'No hay documentos recientes',
  searching: 'Buscando…',
} satisfies Record<keyof typeof zh, string>
