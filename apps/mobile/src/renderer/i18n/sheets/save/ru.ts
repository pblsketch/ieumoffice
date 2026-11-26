import type { zh } from './zh'

export const ru = {
  sheetsShareFailed: 'Не удалось поделиться этим файлом.',
  sheetsSaveFailed: 'Не удалось сохранить. Исходный файл не изменён.',
  sheetsSaveNotYet: 'Эту книгу пока нельзя сохранить на телефоне.',
} as const satisfies Record<keyof typeof zh, string>
