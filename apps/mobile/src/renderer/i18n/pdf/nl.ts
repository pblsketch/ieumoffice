import type { zh } from './zh'
import { nl as view } from './parts/view/nl'
import { nl as edit } from './parts/edit/nl'
import { nl as annot } from './parts/annot/nl'
import { nl as draw } from './parts/draw/nl'
import { nl as sign } from './parts/sign/nl'
import { nl as form } from './parts/form/nl'
import { nl as text } from './parts/text/nl'
import { nl as pages } from './parts/pages/nl'
import { nl as link } from './parts/link/nl'
import { nl as ai } from './parts/ai/nl'

// Each feature of track T2 fills its own part under ./parts; this file only joins them.
export const nl = {
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
