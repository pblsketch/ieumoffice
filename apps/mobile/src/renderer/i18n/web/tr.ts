import type { zh } from './zh'

export const tr = {
  webNotUtf8Notice:
    'Bu dosya UTF-8 kodlamasında olmadığı için düzenlenemez. Yine de görüntüleyebilir ve orijinalini paylaşabilirsiniz.',
} as const satisfies Record<keyof typeof zh, string>
