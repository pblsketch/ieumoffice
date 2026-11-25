import type { zh } from './zh'
import { en as view } from './parts/view/en'
import { en as edit } from './parts/edit/en'
import { en as annot } from './parts/annot/en'
import { en as draw } from './parts/draw/en'
import { en as sign } from './parts/sign/en'
import { en as form } from './parts/form/en'
import { en as text } from './parts/text/en'
import { en as pages } from './parts/pages/en'
import { en as link } from './parts/link/en'
import { en as ai } from './parts/ai/en'

// Each feature of track T2 fills its own part under ./parts; this file only joins them.
export const en = {
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
