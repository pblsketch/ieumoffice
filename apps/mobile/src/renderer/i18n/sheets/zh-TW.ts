import type { zh } from './zh'
import { zhTW as open } from './open/zh-TW'
import { zhTW as grid } from './grid/zh-TW'
import { zhTW as toolbar } from './toolbar/zh-TW'
import { zhTW as save } from './save/zh-TW'
import { zhTW as ai } from './ai/zh-TW'

export const zhTW = { ...open, ...grid, ...toolbar, ...save, ...ai } as const satisfies Record<
  keyof typeof zh,
  string
>
