import type { zh } from './zh'
import { hi as open } from './open/hi'
import { hi as grid } from './grid/hi'
import { hi as toolbar } from './toolbar/hi'
import { hi as save } from './save/hi'
import { hi as ai } from './ai/hi'

export const hi = { ...open, ...grid, ...toolbar, ...save, ...ai } as const satisfies Record<
  keyof typeof zh,
  string
>
