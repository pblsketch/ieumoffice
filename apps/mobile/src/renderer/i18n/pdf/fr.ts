import type { zh } from './zh'
import { fr as view } from './parts/view/fr'
import { fr as edit } from './parts/edit/fr'
import { fr as annot } from './parts/annot/fr'
import { fr as draw } from './parts/draw/fr'
import { fr as sign } from './parts/sign/fr'
import { fr as form } from './parts/form/fr'
import { fr as text } from './parts/text/fr'
import { fr as pages } from './parts/pages/fr'
import { fr as link } from './parts/link/fr'
import { fr as ai } from './parts/ai/fr'

// Each feature of track T2 fills its own part under ./parts; this file only joins them.
export const fr = {
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
