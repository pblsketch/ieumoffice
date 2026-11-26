import type { zh } from './zh'

export const de = {
  webNotUtf8Notice:
    'Diese Datei ist nicht UTF-8-kodiert und kann deshalb nicht bearbeitet werden. Ansehen und das Original teilen geht weiterhin.',
} as const satisfies Record<keyof typeof zh, string>
