import type { zh } from './zh'
import { id as open } from './open/id'
import { id as grid } from './grid/id'
import { id as toolbar } from './toolbar/id'
import { id as save } from './save/id'
import { id as ai } from './ai/id'

export const id = { ...open, ...grid, ...toolbar, ...save, ...ai } as const satisfies Record<
  keyof typeof zh,
  string
>
