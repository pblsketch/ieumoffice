import type { zh } from './zh'
import { id as view } from './parts/view/id'
import { id as edit } from './parts/edit/id'
import { id as annot } from './parts/annot/id'
import { id as draw } from './parts/draw/id'
import { id as sign } from './parts/sign/id'
import { id as form } from './parts/form/id'
import { id as text } from './parts/text/id'
import { id as pages } from './parts/pages/id'
import { id as link } from './parts/link/id'
import { id as ai } from './parts/ai/id'

// Each feature of track T2 fills its own part under ./parts; this file only joins them.
export const id = {
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
