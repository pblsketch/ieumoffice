import { zh as view } from './parts/view/zh'
import { zh as edit } from './parts/edit/zh'
import { zh as annot } from './parts/annot/zh'
import { zh as draw } from './parts/draw/zh'
import { zh as sign } from './parts/sign/zh'
import { zh as form } from './parts/form/zh'
import { zh as text } from './parts/text/zh'
import { zh as pages } from './parts/pages/zh'
import { zh as link } from './parts/link/zh'
import { zh as ai } from './parts/ai/zh'

// Each feature of track T2 fills its own part under ./parts; this file only joins them.
export const zh = {
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
} as const
