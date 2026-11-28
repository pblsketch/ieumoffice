import type { zh } from './zh'
import { ko as frameKo } from './frame/ko'
import { ko as actionsKo } from './actions/ko'
import { ko as foldersKo } from './folders/ko'
import { ko as settingsKo } from './settings/ko'
import { ko as layerKo } from './layer/ko'
import { ko as helpKo } from './help/ko'

// Track T6 home strings: one part per feature folder, merged here.
export const ko = {
  ...frameKo,
  ...actionsKo,
  ...foldersKo,
  ...settingsKo,
  ...layerKo,
  ...helpKo,
} as const satisfies Record<keyof typeof zh, string>
