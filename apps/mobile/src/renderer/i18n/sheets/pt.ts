import type { zh } from './zh'
import { pt as open } from './open/pt'
import { pt as grid } from './grid/pt'
import { pt as toolbar } from './toolbar/pt'
import { pt as save } from './save/pt'
import { pt as ai } from './ai/pt'

export const pt = { ...open, ...grid, ...toolbar, ...save, ...ai } as const satisfies Record<
  keyof typeof zh,
  string
>
