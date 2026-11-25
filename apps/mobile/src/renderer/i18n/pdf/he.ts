import type { zh } from './zh'
import { he as view } from './parts/view/he'
import { he as edit } from './parts/edit/he'
import { he as annot } from './parts/annot/he'
import { he as draw } from './parts/draw/he'
import { he as sign } from './parts/sign/he'
import { he as form } from './parts/form/he'
import { he as text } from './parts/text/he'
import { he as pages } from './parts/pages/he'
import { he as link } from './parts/link/he'
import { he as ai } from './parts/ai/he'

// Each feature of track T2 fills its own part under ./parts; this file only joins them.
export const he = {
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
