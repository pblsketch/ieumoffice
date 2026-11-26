import type { zh } from './zh'
import { he as open } from './open/he'
import { he as grid } from './grid/he'
import { he as toolbar } from './toolbar/he'
import { he as save } from './save/he'
import { he as ai } from './ai/he'

export const he = { ...open, ...grid, ...toolbar, ...save, ...ai } as const satisfies Record<
  keyof typeof zh,
  string
>
