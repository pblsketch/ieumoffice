import type { zh } from './zh'

export const ru = {
  homeFolderListLabel: 'Подключённые папки',
  homeFolderEmptyTitle: 'Папки пока не подключены',
  homeFolderEmptyBody:
    'Подключите папку, которой часто пользуетесь, и её документы и изображения появятся здесь.',
  homeFolderLink: 'Подключить папку',
  homeFolderRelink: 'Подключить снова',
  homeFolderRelinkNamed: 'Подключить {name} снова',
  homeFolderOk: 'Подключена',
  homeFolderLostRevoked: 'Разрешение на доступ к этой папке пропало. Подключите её снова.',
  homeFolderLostMissing: 'Папка не найдена. Если вы её переместили или удалили, подключите снова.',
  homeFolderLost: 'Нет доступа к папке. Подключите её снова.',
  homeFolderMenu: 'Меню: {name}',
  homeFolderRemove: 'Убрать',
  homeFolderRemoveTitle: 'Убрать папку «{name}»?',
  homeFolderRemoveBody:
    'Записи в недавних и избранном для файлов из этой папки ({count}) тоже будут убраны. Сами файлы останутся.',
  homeFolderRemoved: 'Папка убрана.',
  homeFolderBack: 'На уровень выше',
  homeFolderPath: 'Текущая папка',
  homeFolderSubfolder: 'Папка',
  homeFolderInsideEmpty: 'В этой папке нет документов или изображений, которые можно открыть.',
} as const satisfies Record<keyof typeof zh, string>
