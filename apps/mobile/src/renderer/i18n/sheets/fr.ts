import type { zh } from './zh'
import { fr as open } from './open/fr'
import { fr as grid } from './grid/fr'
import { fr as toolbar } from './toolbar/fr'
import { fr as save } from './save/fr'
import { fr as ai } from './ai/fr'

export const fr = { ...open, ...grid, ...toolbar, ...save, ...ai } as const satisfies Record<
  keyof typeof zh,
  string
>
