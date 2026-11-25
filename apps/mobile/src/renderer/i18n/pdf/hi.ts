import type { zh } from './zh'
import { hi as view } from './parts/view/hi'
import { hi as edit } from './parts/edit/hi'
import { hi as annot } from './parts/annot/hi'
import { hi as draw } from './parts/draw/hi'
import { hi as sign } from './parts/sign/hi'
import { hi as form } from './parts/form/hi'
import { hi as text } from './parts/text/hi'
import { hi as pages } from './parts/pages/hi'
import { hi as link } from './parts/link/hi'
import { hi as ai } from './parts/ai/hi'

// Each feature of track T2 fills its own part under ./parts; this file only joins them.
export const hi = {
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
