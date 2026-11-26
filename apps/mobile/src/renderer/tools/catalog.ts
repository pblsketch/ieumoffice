/**
 * The tools the phone offers (spec 2.1) in the groups of the tools list, with
 * the string keys of their names and one-line descriptions. Pure values: no
 * pdf-lib, so the home tab can draw the list without loading the tools.
 */
import type { PdfToolId } from '@genoffice/pdf-ops/tool-ids'
import type { MobileStringKey } from '../i18n'

/** The tools of the first mobile version */
export type MobilePdfToolId = Extract<
  PdfToolId,
  | 'merge'
  | 'split'
  | 'extract'
  | 'reverse'
  | 'rotate'
  | 'blankPages'
  | 'imagesToPdf'
  | 'toText'
  | 'compress'
  | 'encrypt'
  | 'decrypt'
  | 'repair'
  | 'stripAnnots'
>

export interface ToolGroup {
  readonly titleKey: MobileStringKey
  readonly tools: readonly MobilePdfToolId[]
}

/** The four groups of the tools list, in the PC window's order */
export const TOOL_GROUPS: readonly ToolGroup[] = [
  {
    titleKey: 'pdfToolsGroupOrganize',
    tools: ['merge', 'split', 'extract', 'reverse', 'rotate', 'blankPages'],
  },
  { titleKey: 'pdfToolsGroupConvert', tools: ['imagesToPdf', 'toText'] },
  { titleKey: 'pdfToolsGroupSizeSecurity', tools: ['compress', 'encrypt', 'decrypt', 'repair'] },
  { titleKey: 'pdfToolsGroupClean', tools: ['stripAnnots'] },
]

/** Every tool of the list, in order */
export const MOBILE_PDF_TOOLS: readonly MobilePdfToolId[] = TOOL_GROUPS.flatMap((g) => g.tools)

export function isMobilePdfTool(value: string): value is MobilePdfToolId {
  return (MOBILE_PDF_TOOLS as readonly string[]).includes(value)
}

const NAME_KEYS: Readonly<Record<MobilePdfToolId, MobileStringKey>> = {
  merge: 'pdfToolsToolMerge',
  split: 'pdfToolsToolSplit',
  extract: 'pdfToolsToolExtract',
  reverse: 'pdfToolsToolReverse',
  rotate: 'pdfToolsToolRotate',
  blankPages: 'pdfToolsToolBlankPages',
  imagesToPdf: 'pdfToolsToolImagesToPdf',
  toText: 'pdfToolsToolToText',
  compress: 'pdfToolsToolCompress',
  encrypt: 'pdfToolsToolEncrypt',
  decrypt: 'pdfToolsToolDecrypt',
  repair: 'pdfToolsToolRepair',
  stripAnnots: 'pdfToolsToolStripAnnots',
}

const DESC_KEYS: Readonly<Record<MobilePdfToolId, MobileStringKey>> = {
  merge: 'pdfToolsDescMerge',
  split: 'pdfToolsDescSplit',
  extract: 'pdfToolsDescExtract',
  reverse: 'pdfToolsDescReverse',
  rotate: 'pdfToolsDescRotate',
  blankPages: 'pdfToolsDescBlankPages',
  imagesToPdf: 'pdfToolsDescImagesToPdf',
  toText: 'pdfToolsDescToText',
  compress: 'pdfToolsDescCompress',
  encrypt: 'pdfToolsDescEncrypt',
  decrypt: 'pdfToolsDescDecrypt',
  repair: 'pdfToolsDescRepair',
  stripAnnots: 'pdfToolsDescStripAnnots',
}

export const toolNameKey = (tool: MobilePdfToolId): MobileStringKey => NAME_KEYS[tool]
export const toolDescKey = (tool: MobilePdfToolId): MobileStringKey => DESC_KEYS[tool]
