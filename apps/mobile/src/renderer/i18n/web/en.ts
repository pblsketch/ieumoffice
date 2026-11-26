import type { zh } from './zh'

export const en = {
  webNotUtf8Notice:
    "This file is not in UTF-8, so it can't be edited. You can still view it and share the original.",
} as const satisfies Record<keyof typeof zh, string>
