import type { zh } from './zh'
import { it as view } from './parts/view/it'
import { it as edit } from './parts/edit/it'
import { it as annot } from './parts/annot/it'
import { it as draw } from './parts/draw/it'
import { it as sign } from './parts/sign/it'
import { it as form } from './parts/form/it'
import { it as text } from './parts/text/it'
import { it as pages } from './parts/pages/it'
import { it as link } from './parts/link/it'
import { it as ai } from './parts/ai/it'

// Each feature of track T2 fills its own part under ./parts; this file only joins them.
export const it = {
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
