import type { zh } from './zh'
import { nl as frameNl } from './frame/nl'
import { nl as actionsNl } from './actions/nl'
import { nl as foldersNl } from './folders/nl'
import { nl as settingsNl } from './settings/nl'
import { nl as layerNl } from './layer/nl'
import { nl as helpNl } from './help/nl'

// Track T6 home strings: one part per feature folder, merged here.
export const nl = {
  ...frameNl,
  ...actionsNl,
  ...foldersNl,
  ...settingsNl,
  ...layerNl,
  ...helpNl,
} as const satisfies Record<keyof typeof zh, string>
