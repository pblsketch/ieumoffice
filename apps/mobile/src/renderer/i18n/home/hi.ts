import type { zh } from './zh'
import { hi as frameHi } from './frame/hi'
import { hi as actionsHi } from './actions/hi'
import { hi as foldersHi } from './folders/hi'
import { hi as settingsHi } from './settings/hi'
import { hi as layerHi } from './layer/hi'
import { hi as helpHi } from './help/hi'

// Track T6 home strings: one part per feature folder, merged here.
export const hi = {
  ...frameHi,
  ...actionsHi,
  ...foldersHi,
  ...settingsHi,
  ...layerHi,
  ...helpHi,
} as const satisfies Record<keyof typeof zh, string>
