import type { zh } from './zh'
import { ja as view } from './parts/view/ja'
import { ja as edit } from './parts/edit/ja'
import { ja as annot } from './parts/annot/ja'
import { ja as draw } from './parts/draw/ja'
import { ja as sign } from './parts/sign/ja'
import { ja as form } from './parts/form/ja'
import { ja as text } from './parts/text/ja'
import { ja as pages } from './parts/pages/ja'
import { ja as link } from './parts/link/ja'
import { ja as ai } from './parts/ai/ja'

// Each feature of track T2 fills its own part under ./parts; this file only joins them.
export const ja = {
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
