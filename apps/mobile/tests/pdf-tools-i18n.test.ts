import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { pdfToolsStrings } from '../src/renderer/i18n/pdfTools'
import { pdfToolsStrings as pcStrings } from '../../shell/src/renderer/src/i18n/strings-pdf-tools'
import { pdfToolsIcons } from '../src/renderer/components/icons/pdfTools'

// Mobile PDF tools strings come in two kinds. Reused keys take the PC PDF tools window text as is
// (mobile key = 'pdfTools' + the PC key with its first letter upper-cased), so a tool or option
// never has two names. Mobile-only keys hold what the phone says and the PC window does not.

type PcKey = keyof typeof pcStrings.zh

const REUSED_PC_KEYS: readonly PcKey[] = [
  // tools list
  'windowTitle',
  'intro',
  'back',
  'groupOrganize',
  'groupConvert',
  'groupSizeSecurity',
  'groupClean',
  'groupEditor',
  'toolMerge',
  'descMerge',
  'toolSplit',
  'descSplit',
  'toolExtract',
  'descExtract',
  'toolReverse',
  'descReverse',
  'toolRotate',
  'descRotate',
  'toolBlankPages',
  'descBlankPages',
  'toolImagesToPdf',
  'descImagesToPdf',
  'toolToText',
  'descToText',
  'toolCompress',
  'descCompress',
  'toolEncrypt',
  'descEncrypt',
  'toolDecrypt',
  'descDecrypt',
  'toolRepair',
  'descRepair',
  'toolStripAnnots',
  'descStripAnnots',
  'openInEditor',
  // file list
  'pickFiles',
  'addMore',
  'replaceFile',
  'pickImages',
  'addMoreImages',
  'hintOne',
  'hintMerge',
  'hintDecrypt',
  'hintRepair',
  'pageCount',
  'pageCountOne',
  'moveUp',
  'moveDown',
  'remove',
  'errNoInput',
  'errNeedTwo',
  'rejectEncrypted',
  'rejectUnreadable',
  'rejectNotEncrypted',
  // split options
  'splitModeRanges',
  'splitModeFixed',
  'splitModeBookmarks',
  'splitModeMaxSize',
  'splitRangesLabel',
  'splitMergeRanges',
  'splitFixedEvery',
  'splitFixedCount',
  'splitFixedFilesLabel',
  'splitPresetAll',
  'splitPresetEvery',
  'optChunk',
  'splitBookmarkLevel',
  'splitBookmarkLevel1',
  'splitBookmarkLevel2',
  'splitIncludeLeading',
  'splitNoBookmarks',
  'splitLoadingBookmarks',
  'splitMaxSizeLabel',
  'splitMaxSizeNote',
  'splitPreviewCount',
  'splitPreviewOne',
  'splitPreviewDynamic',
  'splitShowFiles',
  'splitHideFiles',
  'splitPrefix',
  'splitPattern',
  'splitPatternNumbered',
  'splitPatternRange',
  'splitPatternBookmark',
  'splitOversizedWarn',
  'errNoBookmarks',
  'errInvalidSize',
  // other tool options
  'optRange',
  'errRange',
  'optRotation',
  'optRotateRight',
  'opt180',
  'optRotateLeft',
  'optLevel',
  'levelLight',
  'levelMedium',
  'levelStrong',
  'noteCompress',
  'errNotSmaller',
  'optPassword',
  'optPasswordConfirm',
  'optRestrict',
  'optPermissionPassword',
  'noteEncrypt',
  'noteRestrict',
  'passwordMismatch',
  'errPasswordEmpty',
  'errPasswordSame',
  'errPasswordLong',
  'optCurrentPassword',
  'noteDecrypt',
  'errWrongPassword',
  'noteRepair',
  'optAnnotKinds',
  'kindComments',
  'kindHighlights',
  'kindDrawings',
  'kindStamps',
  'kindLinks',
  'kindOther',
  'optCleanPages',
  'noteStripAnnots',
  'errNoAnnots',
  'errNoKinds',
  'optPaper',
  'optImageSize',
  'optMargin',
  'optMarginNone',
  'optMarginSmall',
  'optMarginLarge',
  'noteToText',
  'errNoText',
  // blank-page review
  'findBlank',
  'findingBlank',
  'blankNone',
  'blankFound',
  'blankEmpty',
  'blankNearlyWhite',
  'blankPageLabel',
  'selectAll',
  'selectNone',
  'noteBlank',
  'errAllPages',
  'errNotFound',
  'errNoneChosen',
  // processing
  'running',
  'workingProgress',
  'errBusy',
  'errFailed',
  // result sheet
  'doneOne',
  'doneMany',
  'close',
]

/** Mobile-only keys (the phone's own text). */
const MOBILE_ONLY_KEYS: readonly string[] = [
  'pdfToolsDeviceNote',
  'pdfToolsEditCard',
  'pdfToolsEditCardDesc',
  'pdfToolsAddFiles',
  'pdfToolsHintPhotos',
  'pdfToolsNext',
  'pdfToolsProblemEncrypted',
  'pdfToolsProblemUnreadable',
  'pdfToolsProblemNotImage',
  'pdfToolsProblemNotEncrypted',
  'pdfToolsStart',
  'pdfToolsRemoveChosenPages',
  'pdfToolsStop',
  'pdfToolsStopped',
  'pdfToolsStopConfirm',
  'pdfToolsContinue',
  'pdfToolsTooLargeForDevice',
  'pdfToolsMakeFailed',
  'pdfToolsRepairFailed',
  'pdfToolsResultTitle',
  'pdfToolsOpen',
  'pdfToolsShare',
  'pdfToolsSaveCopy',
  'pdfToolsSaved',
  'pdfToolsSaveFailed',
  'pdfToolsShareFailed',
  'pdfToolsSizeChange',
  'pdfToolsZipShareAll',
  'pdfToolsZipSaveAll',
  'pdfToolsDiscardConfirm',
  'pdfToolsCancel',
]

/**
 * PC window text that is wrong on the phone, so the mobile bundle must not reuse it: it speaks of
 * this PC, folders, tabs, save dialogs, the editor ribbon or the PC's 1 GB input cap, offers
 * redaction the phone lacks, or accepts only JPG and PNG while the phone also takes other photos
 * it can decode.
 */
const PC_ONLY_KEYS: readonly PcKey[] = [
  'localNote',
  'toolEdit',
  'descEdit',
  'editorHint',
  'run',
  'openResult',
  'reveal',
  'errMissing',
  'errTooLarge',
  'rejectTooLarge',
  'errSameAsSource',
  'errUnsavedTarget',
  'splitSubfolder',
  'splitVisualInEditor',
  'hintImages',
  'rejectNotImage',
]

/** Tool ids of the mobile tools list (spec 2.1), with `edit` for the edit & sign card. */
const MOBILE_TOOL_IDS = [
  'merge',
  'split',
  'extract',
  'reverse',
  'rotate',
  'blankPages',
  'imagesToPdf',
  'toText',
  'compress',
  'encrypt',
  'decrypt',
  'repair',
  'stripAnnots',
  'edit',
] as const

const mobileKeyOf = (pcKey: string) => `pdfTools${pcKey[0]!.toUpperCase()}${pcKey.slice(1)}`
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('mobile PDF tools strings', () => {
  it('accounts for every key as either reused PC text or mobile-only text', () => {
    const reused = REUSED_PC_KEYS.map(mobileKeyOf)
    expect(new Set(reused).size).toBe(reused.length)
    expect(reused.filter((key) => MOBILE_ONLY_KEYS.includes(key))).toEqual([])
    expect(Object.keys(pdfToolsStrings.zh).sort()).toEqual([...reused, ...MOBILE_ONLY_KEYS].sort())
  })

  it('keeps every reused key equal to the PC window text in all 22 languages', () => {
    expect(LANGS).toHaveLength(22)
    expect(LANGS).toContain('tr')
    for (const lang of LANGS) {
      const mobile: Record<string, string> = pdfToolsStrings[lang]
      const pc: Record<string, string> = pcStrings[lang]
      for (const pcKey of REUSED_PC_KEYS) {
        expect(mobile[mobileKeyOf(pcKey)], `${lang}.${pcKey}`).toBe(pc[pcKey])
      }
    }
  })

  it('reuses no PC-only text', () => {
    expect(REUSED_PC_KEYS.filter((key) => PC_ONLY_KEYS.includes(key))).toEqual([])
    for (const pcKey of PC_ONLY_KEYS) {
      expect(pdfToolsStrings.zh, pcKey).not.toHaveProperty(mobileKeyOf(pcKey))
    }
  })

  it('fills every key in all 22 languages with the same placeholders', () => {
    const keys = Object.keys(pdfToolsStrings.zh).sort()
    for (const lang of LANGS) {
      const dict: Record<string, string> = pdfToolsStrings[lang]
      expect(Object.keys(dict).sort(), `${lang} keys`).toEqual(keys)
      for (const key of keys) {
        const value = dict[key]!
        expect(value.trim().length, `${lang}.${key}`).toBeGreaterThan(0)
        expect(placeholders(value), `${lang}.${key} placeholders`).toEqual(
          placeholders(pdfToolsStrings.en[key as keyof typeof pdfToolsStrings.en]),
        )
      }
    }
  })

  it('names the result size change with its two sizes', () => {
    expect(placeholders(pdfToolsStrings.ko.pdfToolsSizeChange)).toEqual(['after', 'before'])
    expect(pdfToolsStrings.ko.pdfToolsDeviceNote).toBe(
      '이 도구들은 이 기기 안에서만 처리하며 AI를 쓰지 않습니다.',
    )
  })
})

describe('mobile PDF tools icons', () => {
  it('has an icon for every tool of the mobile tools list', () => {
    expect(Object.keys(pdfToolsIcons).sort()).toEqual([...MOBILE_TOOL_IDS].sort())
    for (const id of MOBILE_TOOL_IDS) expect(typeof pdfToolsIcons[id], id).toBe('function')
  })
})
