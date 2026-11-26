import type { zh } from './zh'
import { it as open } from './open/it'
import { it as grid } from './grid/it'
import { it as toolbar } from './toolbar/it'
import { it as save } from './save/it'
import { it as ai } from './ai/it'

export const it = { ...open, ...grid, ...toolbar, ...save, ...ai } as const satisfies Record<
  keyof typeof zh,
  string
>
