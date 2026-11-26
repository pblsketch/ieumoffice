import type { zh } from './zh'

export const ru = {
  sheetsToolbarFormat: 'Формат ячейки',
  sheetsToolbarRows: 'Строки и столбцы',
  sheetsToolbarSort: 'Сортировка и фильтр',
  sheetsToolbarInsert: 'Вставка',
  sheetsToolbarInsertValues: 'Даты и листы',
  sheetsToolbarToday: 'Сегодняшняя дата',
  sheetsToolbarTimeNow: 'Текущее время',
  sheetsToolbarNewSheet: 'Новый лист',
  sheetsToolbarFind: 'Найти',
  sheetsToolbarViewOnly:
    'Диаграммы, сводные таблицы и условное форматирование здесь доступны только для просмотра. Чтобы изменить их, откройте файл на компьютере.',
  sheetsToolbarFullLoaded: 'Вся книга загружена. Нажмите сортировку или фильтр ещё раз.',
} as const satisfies Record<keyof typeof zh, string>
