import type { zh } from './zh'
import { vi as open } from './open/vi'
import { vi as grid } from './grid/vi'
import { vi as toolbar } from './toolbar/vi'
import { vi as save } from './save/vi'
import { vi as ai } from './ai/vi'

export const vi = { ...open, ...grid, ...toolbar, ...save, ...ai } as const satisfies Record<
  keyof typeof zh,
  string
>
