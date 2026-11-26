import type { zh } from './zh'
import { es as open } from './open/es'
import { es as grid } from './grid/es'
import { es as toolbar } from './toolbar/es'
import { es as save } from './save/es'
import { es as ai } from './ai/es'

export const es = { ...open, ...grid, ...toolbar, ...save, ...ai } as const satisfies Record<
  keyof typeof zh,
  string
>
