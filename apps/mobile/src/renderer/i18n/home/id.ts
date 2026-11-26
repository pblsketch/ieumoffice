import type { zh } from './zh'
import { id as frameId } from './frame/id'
import { id as actionsId } from './actions/id'
import { id as foldersId } from './folders/id'
import { id as settingsId } from './settings/id'
import { id as layerId } from './layer/id'
import { id as helpId } from './help/id'

// Track T6 home strings: one part per feature folder, merged here.
export const id = {
  ...frameId,
  ...actionsId,
  ...foldersId,
  ...settingsId,
  ...layerId,
  ...helpId,
} as const satisfies Record<keyof typeof zh, string>
