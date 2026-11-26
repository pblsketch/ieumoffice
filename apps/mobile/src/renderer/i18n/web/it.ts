import type { zh } from './zh'

export const it = {
  webNotUtf8Notice:
    "Questo file non è in UTF-8, quindi non si può modificare. Puoi comunque visualizzarlo e condividere l'originale.",
} as const satisfies Record<keyof typeof zh, string>
