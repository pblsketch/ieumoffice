// Every track's file-type pictures, merged. Tracks fill their own file; this list is already complete.
import { aiDocTypeIcons } from './ai'
import { homeDocTypeIcons } from './home'
import { pdfDocTypeIcons } from './pdf'
import { pdfToolsDocTypeIcons } from './pdfTools'
import { readersDocTypeIcons } from './readers'
import { sheetsDocTypeIcons } from './sheets'
import type { DocTypeIconMap } from './types'
import { webDocTypeIcons } from './web'

export const TRACK_DOC_TYPE_ICONS: DocTypeIconMap = {
  ...sheetsDocTypeIcons,
  ...pdfDocTypeIcons,
  ...pdfToolsDocTypeIcons,
  ...webDocTypeIcons,
  ...readersDocTypeIcons,
  ...homeDocTypeIcons,
  ...aiDocTypeIcons,
}
