import type { zh } from './zh'

export const id = {
  webNotUtf8Notice:
    'File ini tidak dalam UTF-8 sehingga tidak dapat diedit. Anda tetap dapat melihatnya dan membagikan file aslinya.',
} as const satisfies Record<keyof typeof zh, string>
