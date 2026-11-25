import type { zh } from './zh'

export const es = {
  homeSetEditorsTitle: 'Editores',
  homeSetEditorsHint:
    'Los editores desactivados salen de la lista de documentos nuevos. Desactivarlos todos equivale a tenerlos todos activados.',
  homeSetEditorHwp: 'HWP',
  homeSetEditorMarkdown: 'Markdown',
  homeSetEditorPdfTools: 'Herramientas PDF',
  homeSetCardsTitle: 'Documentos nuevos en la pantalla de inicio',
  homeSetCardShow: 'Mostrar {name} en la pantalla de inicio',
  homeSetCardUp: 'Subir {name}',
  homeSetCardDown: 'Bajar {name}',
  homeSetKeepScreenOn: 'Mantener la pantalla encendida al leer',
  homeSetKeepScreenOnDesc:
    'La pantalla no se apaga mientras lees un PDF o un EPUB o presentas un PPT.',
  homeSetFoldersTitle: 'Carpetas de documentos',
  homeSetFoldersEmpty:
    'Aún no hay carpetas vinculadas. Vincula una para ver sus archivos directamente en la pestaña Carpetas.',
  homeSetFolderLink: 'Vincular carpeta',
  homeSetFolderRelink: 'Volver a vincular',
  homeSetFolderRemove: 'Quitar',
  homeSetFolderRemoveNamed: 'Quitar {name}',
  homeSetFolderOk: 'Vinculada',
  homeSetFolderLost:
    'No se puede acceder a esta carpeta. Si la moviste o la borraste, vuelve a vincularla.',
  homeSetFolderRemoveTitle: '¿Quitar la carpeta «{name}»?',
  homeSetFolderRemoveBody:
    'También se quitarán las {count} entradas de recientes y favoritos de los archivos de esta carpeta. Los archivos no se borran.',
  homeSetBackupsTotal: 'Total {size}',
  homeSetStorageTitle: 'Almacenamiento',
  homeSetStorageRecovery: 'Copias de recuperación',
  homeSetStorageTemp: 'Archivos temporales',
  homeSetStorageBackups: 'Copias originales HWP',
  homeSetStorageClearTemp: 'Borrar archivos temporales',
  homeSetStorageClearRecovery: 'Borrar todas las copias de recuperación',
  homeSetStorageClearTempTitle: '¿Borrar los archivos temporales?',
  homeSetStorageClearTempBody:
    'Se borran los archivos creados un momento al compartir o recibir. Tus documentos no cambian.',
  homeSetStorageClearRecoveryTitle: '¿Borrar todas las copias de recuperación?',
  homeSetStorageClearRecoveryBody:
    'Se perderán los cambios sin guardar. Se conserva la copia de recuperación del documento abierto.',
  homeSetStorageClearAction: 'Borrar',
  homeSetStorageCleared: 'Se liberaron {size}.',
  homeSetFailed: 'No se pudo completar. Inténtalo de nuevo en un momento.',
} as const satisfies Record<keyof typeof zh, string>
