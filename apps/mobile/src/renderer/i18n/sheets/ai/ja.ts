import type { zh } from './zh'

export const ja = {
  sheetsAiUndoRefused: 'AI の変更後にシートが編集されたため、元に戻しませんでした。',
  sheetsAiUndoPartial: 'AI の変更の一部を元に戻せませんでした。シートを確認してください。',
  sheetsAiUndoExpired:
    'この AI の変更はもう一度に元に戻せません（その後保存したか、多くの編集をしました）。元に戻すボタンを使ってください。',
} as const satisfies Record<keyof typeof zh, string>
