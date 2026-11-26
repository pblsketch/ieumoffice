import type { zh } from './zh'
import { tr as open } from './open/tr'
import { tr as grid } from './grid/tr'
import { tr as toolbar } from './toolbar/tr'
import { tr as save } from './save/tr'
import { tr as ai } from './ai/tr'

export const tr = { ...open, ...grid, ...toolbar, ...save, ...ai } as const satisfies Record<
  keyof typeof zh,
  string
>
