import type { zh } from './zh'
import { pl as view } from './parts/view/pl'
import { pl as edit } from './parts/edit/pl'
import { pl as annot } from './parts/annot/pl'
import { pl as draw } from './parts/draw/pl'
import { pl as sign } from './parts/sign/pl'
import { pl as form } from './parts/form/pl'
import { pl as text } from './parts/text/pl'
import { pl as pages } from './parts/pages/pl'
import { pl as link } from './parts/link/pl'
import { pl as ai } from './parts/ai/pl'

// Each feature of track T2 fills its own part under ./parts; this file only joins them.
export const pl = {
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
