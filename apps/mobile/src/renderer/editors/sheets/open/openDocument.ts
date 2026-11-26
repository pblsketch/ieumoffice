/**
 * `open()` of the spreadsheet kind (loaded on first use): the working copy,
 * the password prompt, the `.xls`/`.csv` conversion and the engine session,
 * with a progress line while a large file opens, then the notices of spec
 * 2.1 (macros kept but not run, external links show their saved values).
 *
 * Nothing is shown to the person until App switches to the document; if the
 * switch does not go through, `discard()` closes the session and deletes its
 * files.
 */
import { normalizeLang } from '@genoffice/i18n'
import { translateMobile, type MobileStringKey } from '../../../i18n'
import type { EditorOpenRequest, EditorOpened } from '../../editorKind'
import { callSheetsEngine } from '../desktop-api/engine'
import { openSheetsWorkbook, sheetsSessions, type OpenedSheetsWorkbook } from '../session'
import { startSheetsDocument } from '../workspace/document'
import { askSheetsPassword, showOpenProgress } from './overlays'
import { unlockWorkingCopy } from './unlock'

function uiTranslate(): (key: MobileStringKey) => string {
  const lang = normalizeLang(document.documentElement.lang)
  return (key) => translateMobile(lang, key)
}

/** Whether the working copy links to other files (`list_external_links`, as the desktop asks). */
async function hasExternalLinks(
  request: EditorOpenRequest,
  opened: OpenedSheetsWorkbook,
): Promise<boolean> {
  const session = sheetsSessions.get(opened.file.sessionId)
  try {
    const result = (await callSheetsEngine(request.client, 'list_external_links', {
      path: session.snapshotPath,
    })) as { links?: unknown[] }
    return Array.isArray(result.links) && result.links.length > 0
  } catch {
    // The notice is a courtesy: a file the engine cannot list opens without it.
    return false
  }
}

/** The one notice an opened workbook shows (spec 2.1), or null. */
export function openNoticeKey(input: {
  readonly ext: string
  readonly externalLinks: boolean
}): MobileStringKey | null {
  const macros = input.ext === 'xlsm'
  if (macros && input.externalLinks) return 'sheetsNoticeMacrosAndLinks'
  if (macros) return 'sheetsNoticeMacros'
  if (input.externalLinks) return 'sheetsNoticeExternalLinks'
  return null
}

export async function openSheetsDocument(request: EditorOpenRequest): Promise<EditorOpened> {
  const t = uiTranslate()
  const progress = showOpenProgress(t('sheetsOpening'))
  let opened: OpenedSheetsWorkbook
  try {
    opened = await openSheetsWorkbook({
      client: request.client,
      session: request.session,
      ...(request.recoveryBytesBase64 === undefined
        ? {}
        : { recoveryBytesBase64: request.recoveryBytesBase64 }),
      unlock: (copy) =>
        unlockWorkingCopy(request.client, copy, {
          ask: async (retry) => {
            progress.pause()
            try {
              return await askSheetsPassword(t, retry)
            } finally {
              progress.resume()
            }
          },
          refusal: t,
        }),
    })
  } finally {
    progress.close()
  }
  const externalLinks =
    request.recoveryBytesBase64 === undefined ? await hasExternalLinks(request, opened) : false
  return {
    // A workbook opened with a password stays editable: `encrypted` is left unset (spec 5.1).
    noticeKey: openNoticeKey({ ext: request.session.ext.toLowerCase(), externalLinks }),
    start: (host) => startSheetsDocument(host, opened),
    discard: () => void opened.close(),
  }
}
