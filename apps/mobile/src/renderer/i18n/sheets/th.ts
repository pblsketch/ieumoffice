import type { zh } from './zh'
import { th as open } from './open/th'
import { th as grid } from './grid/th'
import { th as toolbar } from './toolbar/th'
import { th as save } from './save/th'
import { th as ai } from './ai/th'

export const th = { ...open, ...grid, ...toolbar, ...save, ...ai } as const satisfies Record<
  keyof typeof zh,
  string
>
