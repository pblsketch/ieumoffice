import type { zh } from './zh'
import { pt as framePt } from './frame/pt'
import { pt as actionsPt } from './actions/pt'
import { pt as foldersPt } from './folders/pt'
import { pt as settingsPt } from './settings/pt'
import { pt as layerPt } from './layer/pt'
import { pt as helpPt } from './help/pt'

// Track T6 home strings: one part per feature folder, merged here.
export const pt = {
  ...framePt,
  ...actionsPt,
  ...foldersPt,
  ...settingsPt,
  ...layerPt,
  ...helpPt,
} as const satisfies Record<keyof typeof zh, string>
