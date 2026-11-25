import type { zh } from './zh'
import { zhTW as frameZhTW } from './frame/zh-TW'
import { zhTW as actionsZhTW } from './actions/zh-TW'
import { zhTW as foldersZhTW } from './folders/zh-TW'
import { zhTW as settingsZhTW } from './settings/zh-TW'
import { zhTW as layerZhTW } from './layer/zh-TW'
import { zhTW as helpZhTW } from './help/zh-TW'

// Track T6 home strings: one part per feature folder, merged here.
export const zhTW = {
  ...frameZhTW,
  ...actionsZhTW,
  ...foldersZhTW,
  ...settingsZhTW,
  ...layerZhTW,
  ...helpZhTW,
} as const satisfies Record<keyof typeof zh, string>
