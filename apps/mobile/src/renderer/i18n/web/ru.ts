import type { zh } from './zh'

export const ru = {
  webNotUtf8Notice:
    'Этот файл не в кодировке UTF-8, поэтому его нельзя изменить. Просматривать его и делиться оригиналом можно.',
} as const satisfies Record<keyof typeof zh, string>
