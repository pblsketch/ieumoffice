import type { zh } from './zh'
import { ja as open } from './open/ja'
import { ja as grid } from './grid/ja'
import { ja as toolbar } from './toolbar/ja'
import { ja as save } from './save/ja'
import { ja as ai } from './ai/ja'

export const ja = { ...open, ...grid, ...toolbar, ...save, ...ai } as const satisfies Record<
  keyof typeof zh,
  string
>
