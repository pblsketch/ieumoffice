import type { zh } from './zh'

export const es = {
  homeFolderListLabel: 'Carpetas vinculadas',
  homeFolderEmptyTitle: 'Aún no hay carpetas vinculadas',
  homeFolderEmptyBody:
    'Vincula una carpeta que uses a menudo y sus documentos e imágenes aparecerán aquí.',
  homeFolderLink: 'Añadir carpeta',
  homeFolderRelink: 'Volver a vincular',
  homeFolderRelinkNamed: 'Volver a vincular {name}',
  homeFolderOk: 'Vinculada',
  homeFolderLostRevoked: 'Se perdió el permiso para esta carpeta. Vuelve a vincularla.',
  homeFolderLostMissing:
    'No se encuentra esta carpeta. Si la moviste o la borraste, vuelve a vincularla.',
  homeFolderLost: 'No se puede acceder a la carpeta. Vuelve a vincularla.',
  homeFolderMenu: 'Menú de {name}',
  homeFolderRemove: 'Quitar',
  homeFolderRemoveTitle: '¿Quitar la carpeta «{name}»?',
  homeFolderRemoveBody:
    'También se quitarán las {count} entradas de recientes y favoritos de los archivos de esta carpeta. Los archivos no se borran.',
  homeFolderRemoved: 'Carpeta quitada.',
  homeFolderBack: 'Carpeta superior',
  homeFolderPath: 'Carpeta actual',
  homeFolderSubfolder: 'Carpeta',
  homeFolderInsideEmpty: 'Esta carpeta no tiene documentos ni imágenes que abrir.',
} as const satisfies Record<keyof typeof zh, string>
