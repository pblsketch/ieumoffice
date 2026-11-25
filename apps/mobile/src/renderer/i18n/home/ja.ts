import type { zh } from './zh'
import { ja as frameJa } from './frame/ja'
import { ja as actionsJa } from './actions/ja'
import { ja as foldersJa } from './folders/ja'
import { ja as settingsJa } from './settings/ja'
import { ja as layerJa } from './layer/ja'
import { ja as helpJa } from './help/ja'

// Track T6 home strings: one part per feature folder, merged here.
export const ja = {
  ...frameJa,
  ...actionsJa,
  ...foldersJa,
  ...settingsJa,
  ...layerJa,
  ...helpJa,
} as const satisfies Record<keyof typeof zh, string>
