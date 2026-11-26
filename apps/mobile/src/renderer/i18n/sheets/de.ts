import type { zh } from './zh'
import { de as open } from './open/de'
import { de as grid } from './grid/de'
import { de as toolbar } from './toolbar/de'
import { de as save } from './save/de'
import { de as ai } from './ai/de'

export const de = { ...open, ...grid, ...toolbar, ...save, ...ai } as const satisfies Record<
  keyof typeof zh,
  string
>
