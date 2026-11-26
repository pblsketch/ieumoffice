import type { zh } from './zh'
import { vi as view } from './parts/view/vi'
import { vi as edit } from './parts/edit/vi'
import { vi as annot } from './parts/annot/vi'
import { vi as draw } from './parts/draw/vi'
import { vi as sign } from './parts/sign/vi'
import { vi as form } from './parts/form/vi'
import { vi as text } from './parts/text/vi'
import { vi as pages } from './parts/pages/vi'
import { vi as link } from './parts/link/vi'
import { vi as ai } from './parts/ai/vi'

// Each feature of track T2 fills its own part under ./parts; this file only joins them.
export const vi = {
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
