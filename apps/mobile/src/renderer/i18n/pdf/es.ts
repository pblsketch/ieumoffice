import type { zh } from './zh'
import { es as view } from './parts/view/es'
import { es as edit } from './parts/edit/es'
import { es as annot } from './parts/annot/es'
import { es as draw } from './parts/draw/es'
import { es as sign } from './parts/sign/es'
import { es as form } from './parts/form/es'
import { es as text } from './parts/text/es'
import { es as pages } from './parts/pages/es'
import { es as link } from './parts/link/es'
import { es as ai } from './parts/ai/es'

// Each feature of track T2 fills its own part under ./parts; this file only joins them.
export const es = {
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
