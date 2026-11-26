import type { zh } from './zh'

export const he = {
  webNotUtf8Notice:
    'הקובץ הזה אינו בקידוד UTF-8, ולכן אי אפשר לערוך אותו. עדיין אפשר להציג אותו ולשתף את המקור.',
} as const satisfies Record<keyof typeof zh, string>
