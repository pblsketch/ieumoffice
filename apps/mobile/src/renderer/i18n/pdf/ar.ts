import type { zh } from './zh'
import { ar as view } from './parts/view/ar'
import { ar as edit } from './parts/edit/ar'
import { ar as annot } from './parts/annot/ar'
import { ar as draw } from './parts/draw/ar'
import { ar as sign } from './parts/sign/ar'
import { ar as form } from './parts/form/ar'
import { ar as text } from './parts/text/ar'
import { ar as pages } from './parts/pages/ar'
import { ar as link } from './parts/link/ar'
import { ar as ai } from './parts/ai/ar'

// Each feature of track T2 fills its own part under ./parts; this file only joins them.
export const ar = {
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
