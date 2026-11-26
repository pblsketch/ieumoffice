import type { zh } from './zh'

export const ms = {
  webNotUtf8Notice:
    'Fail ini bukan dalam UTF-8, jadi ia tidak boleh disunting. Anda masih boleh melihatnya dan berkongsi fail asal.',
} as const satisfies Record<keyof typeof zh, string>
