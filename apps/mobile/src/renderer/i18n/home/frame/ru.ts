import type { zh } from './zh'

export const ru = {
  homeTabNav: 'Меню главного экрана',
  homeTabRecent: 'Недавние',
  homeTabFolders: 'Папки',
  homeTabTools: 'Инструменты',
  homeTabSettings: 'Настройки',
  homeListAll: 'Все',
  homeListFavorites: 'Избранное',
  homeListChips: 'Фильтр списка',
  homeListFamilyHwp: 'HWP',
  homeListFamilyMd: 'Markdown',
  homeListFavoritesEmpty: 'В избранном пока ничего нет. Добавить файл можно через его меню [⋯].',
  homeListGroupEmpty: 'В этой группе пока нет файлов.',
  homeListFavoriteLost: 'Не удаётся открыть файл. Возможно, его переместили или удалили.',
  homeEmptyText: 'Вы ещё не открывали документы. Посмотрите пример или откройте файл.',
  homeEmptySample: 'Открыть пример документа',
  homeEmptyCreate: 'Создать',
  homeCreateFab: 'Создать',
  homeCreateTitle: 'Создать',
  homeCreateClose: 'Закрыть',
  homeCreatePdfTools: 'Инструменты PDF',
} as const satisfies Record<keyof typeof zh, string>
