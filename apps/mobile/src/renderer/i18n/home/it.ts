import type { zh } from './zh'
import { it as frameIt } from './frame/it'
import { it as actionsIt } from './actions/it'
import { it as foldersIt } from './folders/it'
import { it as settingsIt } from './settings/it'
import { it as layerIt } from './layer/it'
import { it as helpIt } from './help/it'

// Track T6 home strings: one part per feature folder, merged here.
export const it = {
  ...frameIt,
  ...actionsIt,
  ...foldersIt,
  ...settingsIt,
  ...layerIt,
  ...helpIt,
} as const satisfies Record<keyof typeof zh, string>
