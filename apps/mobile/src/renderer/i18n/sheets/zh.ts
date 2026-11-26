import { zh as open } from './open/zh'
import { zh as grid } from './grid/zh'
import { zh as toolbar } from './toolbar/zh'
import { zh as save } from './save/zh'
import { zh as ai } from './ai/zh'

// Each area keeps its own files (open/, grid/, toolbar/, save/, ai/); a task changes
// only its own area's folder. zh defines the keys.
export const zh = { ...open, ...grid, ...toolbar, ...save, ...ai } as const
