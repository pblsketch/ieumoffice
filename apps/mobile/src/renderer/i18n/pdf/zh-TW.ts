import type { zh } from './zh'
import { zhTW as view } from './parts/view/zh-TW'
import { zhTW as edit } from './parts/edit/zh-TW'
import { zhTW as annot } from './parts/annot/zh-TW'
import { zhTW as draw } from './parts/draw/zh-TW'
import { zhTW as sign } from './parts/sign/zh-TW'
import { zhTW as form } from './parts/form/zh-TW'
import { zhTW as text } from './parts/text/zh-TW'
import { zhTW as pages } from './parts/pages/zh-TW'
import { zhTW as link } from './parts/link/zh-TW'
import { zhTW as ai } from './parts/ai/zh-TW'

// Each feature of track T2 fills its own part under ./parts; this file only joins them.
export const zhTW = {
  ...view,
  ...edit,
  ...annot,
  ...draw,
  ...sign,
  ...form,
  ...text,
  ...pages,
  ...link,
  ...ai,
} as const satisfies Record<keyof typeof zh, string>
