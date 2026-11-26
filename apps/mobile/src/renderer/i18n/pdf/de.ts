import type { zh } from './zh'
import { de as view } from './parts/view/de'
import { de as edit } from './parts/edit/de'
import { de as annot } from './parts/annot/de'
import { de as draw } from './parts/draw/de'
import { de as sign } from './parts/sign/de'
import { de as form } from './parts/form/de'
import { de as text } from './parts/text/de'
import { de as pages } from './parts/pages/de'
import { de as link } from './parts/link/de'
import { de as ai } from './parts/ai/de'

// Each feature of track T2 fills its own part under ./parts; this file only joins them.
export const de = {
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
