import type { zh } from './zh'
import { ms as frameMs } from './frame/ms'
import { ms as actionsMs } from './actions/ms'
import { ms as foldersMs } from './folders/ms'
import { ms as settingsMs } from './settings/ms'
import { ms as layerMs } from './layer/ms'
import { ms as helpMs } from './help/ms'

// Track T6 home strings: one part per feature folder, merged here.
export const ms = {
  ...frameMs,
  ...actionsMs,
  ...foldersMs,
  ...settingsMs,
  ...layerMs,
  ...helpMs,
} as const satisfies Record<keyof typeof zh, string>
