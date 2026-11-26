import type { zh } from './zh'

export const nl = {
  webNotUtf8Notice:
    'Dit bestand is niet in UTF-8 en kan daarom niet worden bewerkt. Bekijken en het origineel delen kan nog wel.',
} as const satisfies Record<keyof typeof zh, string>
