import type { zh } from './zh'
import { ar as frameAr } from './frame/ar'
import { ar as actionsAr } from './actions/ar'
import { ar as foldersAr } from './folders/ar'
import { ar as settingsAr } from './settings/ar'
import { ar as layerAr } from './layer/ar'
import { ar as helpAr } from './help/ar'

// Track T6 home strings: one part per feature folder, merged here.
export const ar = {
  ...frameAr,
  ...actionsAr,
  ...foldersAr,
  ...settingsAr,
  ...layerAr,
  ...helpAr,
} as const satisfies Record<keyof typeof zh, string>
