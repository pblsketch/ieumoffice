import type { zh } from './zh'
import { pl as open } from './open/pl'
import { pl as grid } from './grid/pl'
import { pl as toolbar } from './toolbar/pl'
import { pl as save } from './save/pl'
import { pl as ai } from './ai/pl'

export const pl = { ...open, ...grid, ...toolbar, ...save, ...ai } as const satisfies Record<
  keyof typeof zh,
  string
>
