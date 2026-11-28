import type { zh } from './zh'
import { th as view } from './parts/view/th'
import { th as edit } from './parts/edit/th'
import { th as annot } from './parts/annot/th'
import { th as draw } from './parts/draw/th'
import { th as sign } from './parts/sign/th'
import { th as form } from './parts/form/th'
import { th as text } from './parts/text/th'
import { th as pages } from './parts/pages/th'
import { th as link } from './parts/link/th'
import { th as ai } from './parts/ai/th'

// Each feature of track T2 fills its own part under ./parts; this file only joins them.
export const th = {
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
