import type { zh } from './zh'
import { ar as open } from './open/ar'
import { ar as grid } from './grid/ar'
import { ar as toolbar } from './toolbar/ar'
import { ar as save } from './save/ar'
import { ar as ai } from './ai/ar'

export const ar = { ...open, ...grid, ...toolbar, ...save, ...ai } as const satisfies Record<
  keyof typeof zh,
  string
>
