import type { zh } from './zh'
import { fr as frameFr } from './frame/fr'
import { fr as actionsFr } from './actions/fr'
import { fr as foldersFr } from './folders/fr'
import { fr as settingsFr } from './settings/fr'
import { fr as layerFr } from './layer/fr'
import { fr as helpFr } from './help/fr'

// Track T6 home strings: one part per feature folder, merged here.
export const fr = {
  ...frameFr,
  ...actionsFr,
  ...foldersFr,
  ...settingsFr,
  ...layerFr,
  ...helpFr,
} as const satisfies Record<keyof typeof zh, string>
