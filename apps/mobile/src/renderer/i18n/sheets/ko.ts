import type { zh } from './zh'
import { ko as open } from './open/ko'
import { ko as grid } from './grid/ko'
import { ko as toolbar } from './toolbar/ko'
import { ko as save } from './save/ko'
import { ko as ai } from './ai/ko'

export const ko = { ...open, ...grid, ...toolbar, ...save, ...ai } as const satisfies Record<
  keyof typeof zh,
  string
>
