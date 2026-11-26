import type { zh } from './zh'
import { ru as view } from './parts/view/ru'
import { ru as edit } from './parts/edit/ru'
import { ru as annot } from './parts/annot/ru'
import { ru as draw } from './parts/draw/ru'
import { ru as sign } from './parts/sign/ru'
import { ru as form } from './parts/form/ru'
import { ru as text } from './parts/text/ru'
import { ru as pages } from './parts/pages/ru'
import { ru as link } from './parts/link/ru'
import { ru as ai } from './parts/ai/ru'

// Each feature of track T2 fills its own part under ./parts; this file only joins them.
export const ru = {
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
