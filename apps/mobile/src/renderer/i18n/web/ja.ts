import type { zh } from './zh'

export const ja = {
  webNotUtf8Notice:
    'このファイルは UTF-8 ではないため編集できません。表示と元のファイルの共有はできます。',
} as const satisfies Record<keyof typeof zh, string>
