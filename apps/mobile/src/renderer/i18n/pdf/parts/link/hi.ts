import type { zh } from './zh'

export const hi = {} as const satisfies Record<keyof typeof zh, string>
