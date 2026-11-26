import type { zh } from './zh'
import { cs as open } from './open/cs'
import { cs as grid } from './grid/cs'
import { cs as toolbar } from './toolbar/cs'
import { cs as save } from './save/cs'
import { cs as ai } from './ai/cs'

export const cs = { ...open, ...grid, ...toolbar, ...save, ...ai } as const satisfies Record<
  keyof typeof zh,
  string
>
