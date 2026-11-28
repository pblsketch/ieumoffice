import type { zh } from './zh'
import { ms as view } from './parts/view/ms'
import { ms as edit } from './parts/edit/ms'
import { ms as annot } from './parts/annot/ms'
import { ms as draw } from './parts/draw/ms'
import { ms as sign } from './parts/sign/ms'
import { ms as form } from './parts/form/ms'
import { ms as text } from './parts/text/ms'
import { ms as pages } from './parts/pages/ms'
import { ms as link } from './parts/link/ms'
import { ms as ai } from './parts/ai/ms'

// Each feature of track T2 fills its own part under ./parts; this file only joins them.
export const ms = {
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
