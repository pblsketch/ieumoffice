import { buildHidingMemoText, isHidingMemoText } from '@genoffice/agent-core/hiding-memo'
import { parseDocx } from '@genoffice/docx-engine'
import { PRODUCT_NAME } from '@genoffice/i18n'
import type { HwpDocument } from '@rhwp/core'
import { call, exportDocument, withNewDocument, withOpenedDocument, type HwpEngine } from './engine'
import { hangulLook, wordLook, type HwpLook } from './look'
import { lowerDocument } from './lower'
import { LossLedger, type Loss } from './losses'
import { writePlan, type HidingMemos } from './write'

export type HwpFormat = 'hwp' | 'hwpx'

export interface HwpConversion {
  /** a file the engine has opened again */
  readonly bytes: Uint8Array
  /** what the copy does not carry, in a fixed order; empty when nothing was lost */
  readonly losses: Loss[]
}

export type Docx2HwpErrorCode =
  /** the bytes are not a Word document docx-engine reads */
  | 'not-docx'
  /** .hwp only: the engine reading its own .hwp back lays it out differently */
  | 'hwp-readback'
  | 'failed'

export class Docx2HwpError extends Error {
  constructor(
    readonly code: Docx2HwpErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'Docx2HwpError'
  }
}

export interface HwpConversionOptions {
  /**
   * 'word' (the default) keeps the layout the Word document has. 'hangul' is
   * for a Word document that only carries another format's content (Markdown):
   * its tables get the look of a document written in Hangul.
   */
  readonly look?: HwpLook
  /**
   * The screen language a Word hiding mark's memo is written in: the memo's
   * bracketed prefix is "hide sensitive info" in this language (every
   * language's prefix is recognised). English when absent, as the terminal
   * command speaks.
   */
  readonly hidingLang?: string
}

/** the earlier name of the options, kept for the callers written against it */
export type Docx2HwpOptions = HwpConversionOptions

/** Word document bytes (lazily served pictures already put back) to a Hangul document. */
export function docxToHwp(
  docx: Uint8Array,
  format: HwpFormat,
  engine: HwpEngine,
  options: HwpConversionOptions = {},
): Promise<HwpConversion> {
  return convert(docx, format, engine, {
    batch: true,
    look: options.look ?? 'word',
    hidingLang: options.hidingLang,
  })
}

/**
 * A Word hiding mark becomes a hiding memo anchored on the same words. The
 * author is the product name whatever the user's name setting, so a reader
 * of the Hangul file knows where the memo came from.
 */
function hidingMemos(lang: string): HidingMemos {
  return { text: (label) => buildHidingMemoText(label, lang), author: PRODUCT_NAME }
}

/** docxToHwp with the writing strategy chosen: tests and measurements compare them */
export async function convert(
  docx: Uint8Array,
  format: HwpFormat,
  engine: HwpEngine,
  options: { batch: boolean; look?: HwpLook; hidingLang?: string },
): Promise<HwpConversion> {
  let parsed: Awaited<ReturnType<typeof parseDocx>>
  try {
    parsed = await parseDocx(docx)
  } catch (err) {
    throw new Docx2HwpError('not-docx', messageOf(err), { cause: err })
  }
  const ledger = new LossLedger()
  const lowered = lowerDocument(parsed, ledger)
  const plan = options.look === 'hangul' ? hangulLook(lowered) : wordLook(lowered)
  try {
    const hiding = hidingMemos(options.hidingLang ?? 'en')
    let memos = 0
    let lost = 0
    const take = (doc: HwpDocument, as: HwpFormat): Uint8Array => {
      const out = exportDocument(doc, as)
      lost += out.contentLoss
      return out.bytes
    }
    const written = withNewDocument(engine, (doc) => {
      const write = () => {
        memos = writePlan(doc, plan, ledger, hiding)
      }
      if (options.batch) inBatch(doc, write)
      else write()
      if (format === 'hwp' && !hwpReadsBack(doc).same) {
        return { settled: false, bytes: take(doc, 'hwpx') }
      }
      return { settled: true, bytes: take(doc, format) }
    })
    // A table filled inside the batch keeps the height of its empty frame in
    // the engine's layout, so the pages the engine counts are not the pages of
    // the file it writes. The file opened again is laid out from what it
    // holds: that document is the one checked and written as .hwp.
    const bytes = written.settled
      ? written.bytes
      : withOpenedDocument(engine, written.bytes, (fresh) => {
          assertHwpReadsBack(fresh)
          return take(fresh, 'hwp')
        })
    for (let i = 0; i < lost; i++) ledger.note('object', `engine${i}`)
    withOpenedDocument(engine, bytes, (back) => {
      if (back.pageCount() < 1) throw new Docx2HwpError('failed', 'the written file has no pages')
      if (memos > 0) noteMissingHidingMemos(back, memos, ledger)
    })
    return { bytes, losses: ledger.list() }
  } catch (err) {
    if (err instanceof Docx2HwpError) throw err
    throw new Docx2HwpError('failed', messageOf(err), { cause: err })
  }
}

/**
 * The file as written must hold every hiding memo the engine accepted: a
 * table moved into a cell, or the writer, could lose one, and then its words
 * would be in the copy unmarked. Each one missing is reported.
 */
function noteMissingHidingMemos(back: HwpDocument, written: number, ledger: LossLedger): void {
  const list = JSON.parse(back.getMemoList()) as Array<{ text?: unknown }>
  const found = list.filter((m) => typeof m.text === 'string' && isHidingMemoText(m.text)).length
  for (let i = found; i < written; i++) ledger.note('hiding_mark', `readback${i}`)
}

/** the engine lays the document out once at the end instead of after every call */
function inBatch(doc: HwpDocument, write: () => void): void {
  call('batch', () => doc.beginBatch())
  try {
    write()
  } finally {
    call('batch', () => doc.endBatch())
  }
}

/**
 * The Hangul editor's .hwp save rule: the engine writes the .hwp, reads it
 * back and must find the same page count.
 */
function hwpReadsBack(doc: HwpDocument): { same: boolean; before?: number; after?: number } {
  const verify = call<{ recovered?: boolean; pageCountBefore?: number; pageCountAfter?: number }>(
    'hwp verify',
    () => doc.exportHwpVerify(),
  )
  return {
    same: verify.recovered === true && verify.pageCountBefore === verify.pageCountAfter,
    before: verify.pageCountBefore,
    after: verify.pageCountAfter,
  }
}

function assertHwpReadsBack(doc: HwpDocument): void {
  const read = hwpReadsBack(doc)
  if (!read.same) {
    throw new Docx2HwpError(
      'hwp-readback',
      `the .hwp reads back with ${read.after} pages instead of ${read.before}`,
    )
  }
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))
