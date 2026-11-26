import type { zh } from './zh'
import { he as frameHe } from './frame/he'
import { he as actionsHe } from './actions/he'
import { he as foldersHe } from './folders/he'
import { he as settingsHe } from './settings/he'
import { he as layerHe } from './layer/he'
import { he as helpHe } from './help/he'

// Track T6 home strings: one part per feature folder, merged here.
export const he = {
  ...frameHe,
  ...actionsHe,
  ...foldersHe,
  ...settingsHe,
  ...layerHe,
  ...helpHe,
} as const satisfies Record<keyof typeof zh, string>
