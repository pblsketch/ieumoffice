import type { zh } from './zh'

export const ru = {
  sheetsProvisionalNotice: 'Пробная таблица: изменения пока не сохраняются.',
  sheetsLoading: 'Загрузка таблицы…',
  sheetsShareFailed: 'Не удалось поделиться этим файлом.',
  sheetsFreezeTopRow: 'Закрепить верхнюю строку',
  sheetsFreezeFirstColumn: 'Закрепить первый столбец',
  sheetsUnfreeze: 'Снять закрепление',
  sheetsKeyboardBar: 'Инструменты ввода формул',
  sheetsInsertSum: 'Функция суммы',
  sheetsInsertParens: 'Скобки',
  sheetsNumericKeys: 'Цифровая клавиатура',
  sheetsCancelEdit: 'Отмена',
  sheetsConfirmEdit: 'Готово',
} as const satisfies Record<keyof typeof zh, string>
