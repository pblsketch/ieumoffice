import type { zh } from './zh'

export const ru = {
  pdfDrawSettings: 'Настройки пера',
  pdfDrawTool: 'Инструмент',
  pdfDrawPen: 'Перо',
  pdfDrawRect: 'Прямоугольник',
  pdfDrawEllipse: 'Эллипс',
  pdfDrawLine: 'Линия',
  pdfDrawArrow: 'Стрелка',
  pdfDrawEraser: 'Ластик',
  pdfDrawColor: 'Цвет',
  pdfDrawColorRed: 'Красный',
  pdfDrawColorYellow: 'Жёлтый',
  pdfDrawColorGreen: 'Зелёный',
  pdfDrawColorBlue: 'Синий',
  pdfDrawColorBlack: 'Чёрный',
  pdfDrawWidth: 'Толщина',
  pdfDrawWidthValue: '{width} пт',
  pdfDrawFinger: 'Рисовать и пальцем',
  pdfDrawFingerHint:
    'Если включено, палец рисует и после использования пера. Если выключено, после использования пера палец перемещает страницу.',
  pdfDrawEraserHint: 'Ластик стирает только ещё не сохранённые штрихи и фигуры.',
  pdfDrawRefused: 'Сейчас рисовать нельзя. Повторите попытку чуть позже.',
} as const satisfies Record<keyof typeof zh, string>
