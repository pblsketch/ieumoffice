import type { zh } from './zh'

export const ru = {
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
