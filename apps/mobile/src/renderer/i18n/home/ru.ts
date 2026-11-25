import type { zh } from './zh'
import { ru as frameRu } from './frame/ru'
import { ru as actionsRu } from './actions/ru'
import { ru as foldersRu } from './folders/ru'
import { ru as settingsRu } from './settings/ru'
import { ru as layerRu } from './layer/ru'
import { ru as helpRu } from './help/ru'

// Track T6 home strings: one part per feature folder, merged here.
export const ru = {
  ...frameRu,
  ...actionsRu,
  ...foldersRu,
  ...settingsRu,
  ...layerRu,
  ...helpRu,
} as const satisfies Record<keyof typeof zh, string>
