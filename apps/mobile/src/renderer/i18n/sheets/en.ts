import type { zh } from './zh'
import { en as open } from './open/en'
import { en as grid } from './grid/en'
import { en as toolbar } from './toolbar/en'
import { en as save } from './save/en'
import { en as ai } from './ai/en'

export const en = { ...open, ...grid, ...toolbar, ...save, ...ai } as const satisfies Record<
  keyof typeof zh,
  string
>
