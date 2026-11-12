import { extname } from 'node:path'
import JSZip from 'jszip'
import { assertZipInflatesWithinLimits, assertZipWithinLimits } from '@genoffice/docx-engine'
import { readHidingMemoLabel } from '@genoffice/agent-core/hiding-memo'
import { isHidingName } from '@genoffice/agent-core/hiding-name'
import { REDACT_EL } from '@genoffice/agent-core/redact-range'
import { redactDocxPartXml } from './docx-redaction'
import { redactHtmlSource } from './html-redaction'
import { hwpMemosOf } from './hwp'
import { redactMarkdownSource } from './markdown-redaction'
import { PPTX_REDACT_EXT_URI } from './pptx-redaction'
import { decodeEntities } from './xml-elements'

/**
 * Whether a document file holds hiding marks, read the way the per-format
 * readers read them (no reading of its text): for a caller that has to treat
 * a marked file differently from an unmarked one, such as saving a document
 * as a template "as it is" or converting it for a model.
 *
 * - `marked`: at least one mark hides something.
 * - `none`: no mark, or the format has none.
 * - `unknown`: the file could not be looked into, or a mark in it cannot be
 *   read. A caller that must not let hidden content through treats this as
 *   marked.
 */
export type HidingMarks = 'none' | 'marked' | 'unknown'

const isZip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b

async function zipParts(bytes: Uint8Array, wanted: RegExp): Promise<string[]> {
  await assertZipInflatesWithinLimits(bytes)
  const zip = await JSZip.loadAsync(bytes)
  assertZipWithinLimits(zip)
  const out: string[] = []
  for (const entry of Object.values(zip.files)) {
    if (!entry.dir && wanted.test(entry.name)) out.push(await entry.async('string'))
  }
  return out
}

function changedBy(redact: (text: string) => string, text: string): HidingMarks {
  try {
    return redact(text) === text ? 'none' : 'marked'
  } catch {
    return 'unknown'
  }
}

async function wordMarks(bytes: Uint8Array): Promise<HidingMarks> {
  let found: HidingMarks = 'none'
  for (const xml of await zipParts(bytes, /\.xml$/i)) {
    const read = changedBy(redactDocxPartXml, xml)
    if (read === 'unknown') return 'unknown'
    if (read === 'marked' || xml.includes(`<${REDACT_EL}`)) found = 'marked'
  }
  return found
}

async function workbookMarks(bytes: Uint8Array): Promise<HidingMarks> {
  const [workbook] = await zipParts(bytes, /^xl\/workbook\.xml$/i)
  if (workbook === undefined) return 'unknown'
  for (const m of workbook.matchAll(
    /<(?:[\w.-]+:)?definedName\b[^>]*?\bname\s*=\s*(["'])(.*?)\1/g,
  )) {
    if (isHidingName(decodeEntities(m[2]!))) return 'marked'
  }
  return 'none'
}

async function deckMarks(bytes: Uint8Array): Promise<HidingMarks> {
  for (const xml of await zipParts(bytes, /\.xml$/i)) {
    if (xml.includes(PPTX_REDACT_EXT_URI) || xml.includes(`<${REDACT_EL}`)) return 'marked'
  }
  return 'none'
}

async function hangulMarks(bytes: Uint8Array): Promise<HidingMarks> {
  const memos = await hwpMemosOf(bytes)
  return memos.some((memo) => readHidingMemoLabel(String(memo.text ?? '')) !== null)
    ? 'marked'
    : 'none'
}

/** Whether the file named `fileName`, with these bytes, holds hiding marks. */
export async function hidingMarksOf(fileName: string, bytes: Uint8Array): Promise<HidingMarks> {
  const ext = extname(fileName).slice(1).toLowerCase()
  const text = () => new TextDecoder('utf-8').decode(bytes)
  try {
    switch (ext) {
      case 'md':
      case 'markdown':
      case 'txt':
      case 'json':
        return changedBy(redactMarkdownSource, text())
      case 'html':
      case 'htm':
        return changedBy(redactHtmlSource, text())
      case 'pptx':
        return await deckMarks(bytes)
      case 'docx':
        return await wordMarks(bytes)
      case 'doc':
        // a Word file under the old name is read as one; a real .doc has no marks
        return isZip(bytes) ? await wordMarks(bytes) : 'none'
      case 'xlsx':
      case 'xlsm':
        return await workbookMarks(bytes)
      case 'hwp':
      case 'hwpx':
        return await hangulMarks(bytes)
      default:
        return 'none'
    }
  } catch {
    return 'unknown'
  }
}
