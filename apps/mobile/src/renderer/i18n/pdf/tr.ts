import type { zh } from './zh'
import { tr as view } from './parts/view/tr'
import { tr as edit } from './parts/edit/tr'
import { tr as annot } from './parts/annot/tr'
import { tr as draw } from './parts/draw/tr'
import { tr as sign } from './parts/sign/tr'
import { tr as form } from './parts/form/tr'
import { tr as text } from './parts/text/tr'
import { tr as pages } from './parts/pages/tr'
import { tr as link } from './parts/link/tr'
import { tr as ai } from './parts/ai/tr'

// Each feature of track T2 fills its own part under ./parts; this file only joins them.
export const tr = {
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
