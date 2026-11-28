import type { zh } from './zh'
import { nl as open } from './open/nl'
import { nl as grid } from './grid/nl'
import { nl as toolbar } from './toolbar/nl'
import { nl as save } from './save/nl'
import { nl as ai } from './ai/nl'

export const nl = { ...open, ...grid, ...toolbar, ...save, ...ai } as const satisfies Record<
  keyof typeof zh,
  string
>
