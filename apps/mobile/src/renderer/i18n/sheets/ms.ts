import type { zh } from './zh'
import { ms as open } from './open/ms'
import { ms as grid } from './grid/ms'
import { ms as toolbar } from './toolbar/ms'
import { ms as save } from './save/ms'
import { ms as ai } from './ai/ms'

export const ms = { ...open, ...grid, ...toolbar, ...save, ...ai } as const satisfies Record<
  keyof typeof zh,
  string
>
