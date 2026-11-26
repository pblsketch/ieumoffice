import type { zh } from './zh'

export const ru = {
  sheetsAiUndoRefused: 'Лист изменили после правок ИИ, поэтому они не отменены.',
  sheetsAiUndoPartial: 'Часть правок ИИ не удалось отменить. Проверьте лист.',
  sheetsAiUndoExpired:
    'Правки ИИ больше нельзя отменить за один шаг (книгу с тех пор сохранили или сильно изменили). Используйте «Отменить».',
} as const satisfies Record<keyof typeof zh, string>
