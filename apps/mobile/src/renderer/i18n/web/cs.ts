import type { zh } from './zh'

export const cs = {
  webNotUtf8Notice:
    'Tento soubor není v kódování UTF-8, a proto ho nelze upravit. Můžete ho stále zobrazit a sdílet originál.',
} as const satisfies Record<keyof typeof zh, string>
