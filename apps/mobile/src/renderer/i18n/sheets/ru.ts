import type { zh } from './zh'
import { ru as open } from './open/ru'
import { ru as grid } from './grid/ru'
import { ru as toolbar } from './toolbar/ru'
import { ru as save } from './save/ru'
import { ru as ai } from './ai/ru'

export const ru = { ...open, ...grid, ...toolbar, ...save, ...ai } as const satisfies Record<
  keyof typeof zh,
  string
>
