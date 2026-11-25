import type { zh } from './zh'
import { ko as view } from './parts/view/ko'
import { ko as edit } from './parts/edit/ko'
import { ko as annot } from './parts/annot/ko'
import { ko as draw } from './parts/draw/ko'
import { ko as sign } from './parts/sign/ko'
import { ko as form } from './parts/form/ko'
import { ko as text } from './parts/text/ko'
import { ko as pages } from './parts/pages/ko'
import { ko as link } from './parts/link/ko'
import { ko as ai } from './parts/ai/ko'

// Each feature of track T2 fills its own part under ./parts; this file only joins them.
export const ko = {
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
