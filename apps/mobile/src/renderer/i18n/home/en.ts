import type { zh } from './zh'
import { en as frameEn } from './frame/en'
import { en as actionsEn } from './actions/en'
import { en as foldersEn } from './folders/en'
import { en as settingsEn } from './settings/en'
import { en as layerEn } from './layer/en'
import { en as helpEn } from './help/en'

// Track T6 home strings: one part per feature folder, merged here.
export const en = {
  ...frameEn,
  ...actionsEn,
  ...foldersEn,
  ...settingsEn,
  ...layerEn,
  ...helpEn,
} as const satisfies Record<keyof typeof zh, string>
