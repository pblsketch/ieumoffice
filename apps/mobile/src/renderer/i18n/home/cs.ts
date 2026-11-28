import type { zh } from './zh'
import { cs as frameCs } from './frame/cs'
import { cs as actionsCs } from './actions/cs'
import { cs as foldersCs } from './folders/cs'
import { cs as settingsCs } from './settings/cs'
import { cs as layerCs } from './layer/cs'
import { cs as helpCs } from './help/cs'

// Track T6 home strings: one part per feature folder, merged here.
export const cs = {
  ...frameCs,
  ...actionsCs,
  ...foldersCs,
  ...settingsCs,
  ...layerCs,
  ...helpCs,
} as const satisfies Record<keyof typeof zh, string>
