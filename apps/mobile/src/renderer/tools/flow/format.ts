/**
 * Small helpers of the tools screen: file sizes in the UI language, picked
 * files as engine inputs, and the messages for refusals and option errors.
 */
import { htmlLang, type Lang } from '@genoffice/i18n'
import type { MobileStringKey } from '../../i18n'
import type { PdfInputProblem, PdfToolId } from '@genoffice/pdf-ops/tool-ids'
import type { ToolFile, ToolRunFailure } from '../engine/types'
import type { ToolOptionsError } from '../options'

/** A file size in the UI language: KB under 1 MB, MB above (the PC tools window's rule) */
export function formatBytes(bytes: number, lang: Lang): string {
  const locale = htmlLang(lang)
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) {
    return new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'megabyte',
      maximumFractionDigits: 1,
    }).format(mb)
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'kilobyte',
    maximumFractionDigits: bytes < 10 * 1024 ? 1 : 0,
  }).format(Math.max(bytes / 1024, bytes > 0 ? 0.1 : 0))
}

const IMAGE_MIMES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  heif: 'image/heif',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
}

/** The MIME type of a picked file; some pickers leave `File.type` empty */
export function mimeOf(file: { readonly name: string; readonly type: string }): string {
  if (file.type) return file.type
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? ''
  if (ext === 'pdf') return 'application/pdf'
  return IMAGE_MIMES[ext] ?? ''
}

/** A picked file as an engine input: every read gives a fresh array (the engine hands it over) */
export function toolFileOf(file: File): ToolFile {
  return {
    name: file.name,
    mime: mimeOf(file),
    readBytes: async () => new Uint8Array(await file.arrayBuffer()),
  }
}

/** What a row says about a file the tool cannot use */
export function problemKey(problem: PdfInputProblem): MobileStringKey {
  switch (problem) {
    case 'encrypted':
      return 'pdfToolsProblemEncrypted'
    case 'not-image':
      return 'pdfToolsProblemNotImage'
    case 'not-encrypted':
      return 'pdfToolsProblemNotEncrypted'
    case 'too-large':
      return 'pdfToolsTooLargeForDevice'
    default:
      return 'pdfToolsProblemUnreadable'
  }
}

/** The message for a tool that ended without a result ('stopped' has its own toast) */
export function failureKey(
  tool: PdfToolId,
  reason: Exclude<ToolRunFailure, 'stopped'>,
): MobileStringKey {
  switch (reason) {
    case 'no-text':
      return 'pdfToolsErrNoText'
    case 'no-annots':
      return 'pdfToolsErrNoAnnots'
    case 'not-smaller':
      return 'pdfToolsErrNotSmaller'
    case 'no-bookmarks':
      return 'pdfToolsErrNoBookmarks'
    case 'wrong-password':
      return 'pdfToolsErrWrongPassword'
    case 'repair-failed':
      return 'pdfToolsRepairFailed'
    case 'too-large':
      return 'pdfToolsTooLargeForDevice'
    default:
      // password tools fail only when their result does not check out again
      return tool === 'encrypt' || tool === 'decrypt' ? 'pdfToolsMakeFailed' : 'pdfToolsErrFailed'
  }
}

/** The message for options the tool does not take */
export function optionsErrorKey(error: ToolOptionsError): MobileStringKey {
  switch (error) {
    case 'range':
      return 'pdfToolsErrRange'
    case 'no-kinds':
      return 'pdfToolsErrNoKinds'
    case 'none-chosen':
      return 'pdfToolsErrNoneChosen'
    case 'all-pages':
      return 'pdfToolsErrAllPages'
    case 'password-empty':
      return 'pdfToolsErrPasswordEmpty'
    case 'password-same':
      return 'pdfToolsErrPasswordSame'
    case 'password-long':
      return 'pdfToolsErrPasswordLong'
    case 'password-mismatch':
      return 'pdfToolsPasswordMismatch'
    case 'invalid-size':
      return 'pdfToolsErrInvalidSize'
  }
}
