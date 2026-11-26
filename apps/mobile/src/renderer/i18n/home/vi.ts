import type { zh } from './zh'
import { vi as frameVi } from './frame/vi'
import { vi as actionsVi } from './actions/vi'
import { vi as foldersVi } from './folders/vi'
import { vi as settingsVi } from './settings/vi'
import { vi as layerVi } from './layer/vi'
import { vi as helpVi } from './help/vi'

// Track T6 home strings: one part per feature folder, merged here.
export const vi = {
  ...frameVi,
  ...actionsVi,
  ...foldersVi,
  ...settingsVi,
  ...layerVi,
  ...helpVi,
} as const satisfies Record<keyof typeof zh, string>
