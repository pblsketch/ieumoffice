import type { zh } from './zh'

export const pl = {
  webNotUtf8Notice:
    'Ten plik nie jest w kodowaniu UTF-8, więc nie można go edytować. Nadal można go wyświetlić i udostępnić oryginał.',
} as const satisfies Record<keyof typeof zh, string>
