import type { zh } from './zh'
import { pt as view } from './parts/view/pt'
import { pt as edit } from './parts/edit/pt'
import { pt as annot } from './parts/annot/pt'
import { pt as draw } from './parts/draw/pt'
import { pt as sign } from './parts/sign/pt'
import { pt as form } from './parts/form/pt'
import { pt as text } from './parts/text/pt'
import { pt as pages } from './parts/pages/pt'
import { pt as link } from './parts/link/pt'
import { pt as ai } from './parts/ai/pt'

// Each feature of track T2 fills its own part under ./parts; this file only joins them.
export const pt = {
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
