import type { zh } from './zh'

export const ru = {
  panelTitle: 'Файлы',
  showPanel: 'Показать панель файлов',
  hidePanel: 'Скрыть панель файлов',
  searchPlaceholder: 'Найти файл',
  sectionCurrent: 'Папка этого документа',
  sectionFolders: 'Папки',
  sectionRecent: 'Недавние',
  addFolder: 'Добавить папку',
  refresh: 'Обновить',
  collapseAll: 'Свернуть все',
  emptyFolder: 'Здесь нет документов, которые можно открыть',
  folderMissing: 'Папка не найдена',
  untitledHint: 'Этот документ ещё не сохранён. Его папка появится здесь после сохранения.',
  noResults: 'Нет подходящих файлов',
  openMark: 'Открыт',
  resizePanel: 'Изменить ширину панели файлов',
  noRecent: 'Нет недавних документов',
  searching: 'Поиск…',
} satisfies Record<keyof typeof zh, string>
