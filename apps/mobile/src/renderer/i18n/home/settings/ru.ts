import type { zh } from './zh'

export const ru = {
  homeSetEditorsTitle: 'Редакторы',
  homeSetEditorsHint:
    'Выключенные редакторы пропадают из списка новых документов. Если выключить все, все считаются включёнными.',
  homeSetEditorHwp: 'HWP',
  homeSetEditorMarkdown: 'Markdown',
  homeSetEditorPdfTools: 'Инструменты PDF',
  homeSetCardsTitle: 'Новые документы на главном экране',
  homeSetCardShow: 'Показывать {name} на главном экране',
  homeSetCardUp: 'Переместить {name} выше',
  homeSetCardDown: 'Переместить {name} ниже',
  homeSetKeepScreenOn: 'Не выключать экран при чтении',
  homeSetKeepScreenOnDesc:
    'Экран не гаснет, пока вы читаете PDF или EPUB или показываете презентацию PPT.',
  homeSetFoldersTitle: 'Папки с документами',
  homeSetFoldersEmpty:
    'Папки ещё не подключены. Подключите папку, чтобы видеть её файлы прямо на вкладке «Папки».',
  homeSetFolderLink: 'Подключить папку',
  homeSetFolderRelink: 'Подключить снова',
  homeSetFolderRemove: 'Убрать',
  homeSetFolderRemoveNamed: 'Убрать {name}',
  homeSetFolderOk: 'Подключена',
  homeSetFolderLost:
    'Нет доступа к этой папке. Если вы её переместили или удалили, подключите снова.',
  homeSetFolderRemoveTitle: 'Убрать папку «{name}»?',
  homeSetFolderRemoveBody:
    'Записи в недавних и избранном для файлов из этой папки ({count}) тоже будут убраны. Сами файлы останутся.',
  homeSetBackupsTotal: 'Всего {size}',
  homeSetStorageTitle: 'Хранилище',
  homeSetStorageRecovery: 'Копии для восстановления',
  homeSetStorageTemp: 'Временные файлы',
  homeSetStorageBackups: 'Резервные копии оригиналов HWP',
  homeSetStorageClearTemp: 'Удалить временные файлы',
  homeSetStorageClearRecovery: 'Удалить все копии для восстановления',
  homeSetStorageClearTempTitle: 'Удалить временные файлы?',
  homeSetStorageClearTempBody:
    'Будут удалены файлы, ненадолго созданные при отправке или получении. Ваши документы не изменятся.',
  homeSetStorageClearRecoveryTitle: 'Удалить все копии для восстановления?',
  homeSetStorageClearRecoveryBody:
    'Несохранённые изменения пропадут. Копия для восстановления открытого сейчас документа останется.',
  homeSetStorageClearAction: 'Удалить',
  homeSetStorageCleared: 'Освобождено {size}.',
  homeSetFailed: 'Не получилось. Попробуйте ещё раз чуть позже.',
} as const satisfies Record<keyof typeof zh, string>
