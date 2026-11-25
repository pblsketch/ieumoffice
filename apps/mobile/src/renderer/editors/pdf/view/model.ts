// The opened PDF document as the mobile editor holds it. Later tasks (edit state,
// save, features, AI) build on this object; it is created once per open.
// The PC PDF types (apps/pdf/src/shared/ipc.ts) reach pdf2docx, whose bidi-js
// typings the PC tsconfig lists; bring the same file in here.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../../../../../../../packages/pdf2docx/src/bidi-js.d.ts" />
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { geomDispSize, type PageGeom } from '../../../../../../pdf/src/renderer/annotations'
import type { PageGeometry } from '../../../../../../pdf/src/renderer/page-probe'
import type { SearchIndexCache } from '../../../../../../pdf/src/renderer/search'
import type { PdfLock, PdfReadOnlyReason } from './readOnly'

export type { PageGeom, PageGeometry, PdfLock, PdfReadOnlyReason }

export interface PdfOpenedDocument {
  /** The document PDF.js shows (built from patched bytes when `damaged`). */
  readonly proxy: PDFDocumentProxy
  /** The bytes as read from the file, recovery copy or blank factory — never the display patch. */
  readonly originalBytes: Uint8Array
  /** The password that opened the document; kept in memory only, for the save path. */
  readonly password: string | null
  /** The file carries an /Encrypt dictionary. */
  readonly encrypted: boolean
  /** The app's own security handler accepted the password (PC `sessionUnlocked`). */
  readonly sessionUnlocked: boolean
  /** Which password opened it and whether /P allows modifying; null when not encrypted or not unlocked. */
  readonly lock: PdfLock | null
  /** Lost page objects are shown as blank pages from a patched copy (PC page-tree-patch). */
  readonly damaged: boolean
  /** 1-based pages whose geometry could not be read; drawn as a broken tile. */
  readonly failedPages: ReadonlySet<number>
  /** Unrotated geometry of every page in document order (PC page-probe). */
  readonly pages: readonly PageGeometry[]
  readonly readOnlyReason: PdfReadOnlyReason | null
  readonly isUntitled: boolean
  readonly fromRecovery: boolean
  /** One text extraction per document, shared by search, AI and text features (PC search.ts). */
  readonly searchIndex: SearchIndexCache
  /** Releases the PDF.js document and its worker. */
  destroy(): Promise<void>
}

/** PC `pageGeom`: the page's unrotated size, origin, user unit and total display rotation. */
export function pdfPageGeom(
  doc: Pick<PdfOpenedDocument, 'pages'>,
  index: number,
  rotationDelta = 0,
): PageGeom {
  const page = doc.pages[index] ?? {
    width: 595,
    height: 842,
    rotate: 0,
    origin: [0, 0],
    userUnit: 1,
  }
  return {
    pw: page.width,
    ph: page.height,
    rot: page.rotate + rotationDelta,
    x0: page.origin[0],
    y0: page.origin[1],
    userUnit: page.userUnit,
  }
}

/** Display size of page `index` at scale 1 (width and height swap with rotation). */
export function pdfPageDisplaySize(
  doc: Pick<PdfOpenedDocument, 'pages'>,
  index: number,
  rotationDelta = 0,
): { width: number; height: number } {
  return geomDispSize(pdfPageGeom(doc, index, rotationDelta))
}
