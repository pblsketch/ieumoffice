import type { zh } from './zh'
import { de as frameDe } from './frame/de'
import { de as actionsDe } from './actions/de'
import { de as foldersDe } from './folders/de'
import { de as settingsDe } from './settings/de'
import { de as layerDe } from './layer/de'
import { de as helpDe } from './help/de'

// Track T6 home strings: one part per feature folder, merged here.
export const de = {
  ...frameDe,
  ...actionsDe,
  ...foldersDe,
  ...settingsDe,
  ...layerDe,
  ...helpDe,
} as const satisfies Record<keyof typeof zh, string>
