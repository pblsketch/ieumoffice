import type { zh } from './zh'
import { pl as framePl } from './frame/pl'
import { pl as actionsPl } from './actions/pl'
import { pl as foldersPl } from './folders/pl'
import { pl as settingsPl } from './settings/pl'
import { pl as layerPl } from './layer/pl'
import { pl as helpPl } from './help/pl'

// Track T6 home strings: one part per feature folder, merged here.
export const pl = {
  ...framePl,
  ...actionsPl,
  ...foldersPl,
  ...settingsPl,
  ...layerPl,
  ...helpPl,
} as const satisfies Record<keyof typeof zh, string>
