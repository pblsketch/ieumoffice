import type { zh } from './zh'
import { es as frameEs } from './frame/es'
import { es as actionsEs } from './actions/es'
import { es as foldersEs } from './folders/es'
import { es as settingsEs } from './settings/es'
import { es as layerEs } from './layer/es'
import { es as helpEs } from './help/es'

// Track T6 home strings: one part per feature folder, merged here.
export const es = {
  ...frameEs,
  ...actionsEs,
  ...foldersEs,
  ...settingsEs,
  ...layerEs,
  ...helpEs,
} as const satisfies Record<keyof typeof zh, string>
