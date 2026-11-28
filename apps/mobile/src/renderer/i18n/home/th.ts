import type { zh } from './zh'
import { th as frameTh } from './frame/th'
import { th as actionsTh } from './actions/th'
import { th as foldersTh } from './folders/th'
import { th as settingsTh } from './settings/th'
import { th as layerTh } from './layer/th'
import { th as helpTh } from './help/th'

// Track T6 home strings: one part per feature folder, merged here.
export const th = {
  ...frameTh,
  ...actionsTh,
  ...foldersTh,
  ...settingsTh,
  ...layerTh,
  ...helpTh,
} as const satisfies Record<keyof typeof zh, string>
