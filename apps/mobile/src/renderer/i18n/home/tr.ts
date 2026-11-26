import type { zh } from './zh'
import { tr as frameTr } from './frame/tr'
import { tr as actionsTr } from './actions/tr'
import { tr as foldersTr } from './folders/tr'
import { tr as settingsTr } from './settings/tr'
import { tr as layerTr } from './layer/tr'
import { tr as helpTr } from './help/tr'

// Track T6 home strings: one part per feature folder, merged here.
export const tr = {
  ...frameTr,
  ...actionsTr,
  ...foldersTr,
  ...settingsTr,
  ...layerTr,
  ...helpTr,
} as const satisfies Record<keyof typeof zh, string>
