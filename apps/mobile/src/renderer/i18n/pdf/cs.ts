import type { zh } from './zh'
import { cs as view } from './parts/view/cs'
import { cs as edit } from './parts/edit/cs'
import { cs as annot } from './parts/annot/cs'
import { cs as draw } from './parts/draw/cs'
import { cs as sign } from './parts/sign/cs'
import { cs as form } from './parts/form/cs'
import { cs as text } from './parts/text/cs'
import { cs as pages } from './parts/pages/cs'
import { cs as link } from './parts/link/cs'
import { cs as ai } from './parts/ai/cs'

// Each feature of track T2 fills its own part under ./parts; this file only joins them.
export const cs = {
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
