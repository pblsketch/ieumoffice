import { zh as frameZh } from './frame/zh'
import { zh as actionsZh } from './actions/zh'
import { zh as foldersZh } from './folders/zh'
import { zh as settingsZh } from './settings/zh'
import { zh as layerZh } from './layer/zh'
import { zh as helpZh } from './help/zh'

// Track T6 home strings: one part per feature folder, merged here.
export const zh = {
  ...frameZh,
  ...actionsZh,
  ...foldersZh,
  ...settingsZh,
  ...layerZh,
  ...helpZh,
} as const
