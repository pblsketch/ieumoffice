import JSZip from 'jszip'
import { placeholderSource, sanitizeLabel } from '@genoffice/agent-core/redact-core'
import { REDACT_EL } from '@genoffice/agent-core/redact-range'
import type { OpenedPptx, Paragraph, SlideElement, TextRun } from '@genoffice/pptx-engine'
import { elementDurableId, slideDurableId } from '@genoffice/pptx-ops'
// the reader the app uses for a deck read as another file's material; the package
// does not export it, so it is reached the way this command line reaches the editors
import { PPTX_REDACT_EXT_URI, redactPptxPartXml } from '../../../file-parse/src/pptx-redaction'
import { unreadableHiding } from '../hiding'

/**
 * Hidden content of a deck (민감정보 가리기) on the command line.
 *
 * Reading: every slide, notes and other XML part goes through the app's own
 * reader for a deck read as another file's material, so a withheld run holds
 * only its `{{label}}` (a withheld picture has no words; the read never names
 * its media). A mark that reader cannot place fails the read.
 *
 * Editing: the deck is opened as it is and every withheld run's text becomes its
 * marker while the ops run (`maskDeck`), so a text search finds nothing hidden
 * and whatever an op echoes shows the marker. After every op the markers and
 * withheld pictures are compared with what was masked (`deckHidingViolation`):
 * an op that removed, rewrote, copied or moved one is refused. Before saving,
 * every run gets its words back (`unmaskDeck`). A deck with no mark is not touched.
 */

/** The deck's bytes as a model may read them; the input itself when nothing is marked. */
export async function redactedDeckBytes(bytes: Uint8Array): Promise<Uint8Array> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    return bytes
  }
  let changed = false
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !/\.xml$/i.test(entry.name)) continue
    const xml = await entry.async('string')
    if (!xml.includes(PPTX_REDACT_EXT_URI) && !xml.includes(`<${REDACT_EL}`)) continue
    let redacted: string
    try {
      redacted = redactPptxPartXml(xml)
    } catch (err) {
      throw unreadableHiding(err)
    }
    if (redacted !== xml) {
      zip.file(entry.name, redacted)
      changed = true
    }
  }
  return changed ? zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }) : bytes
}

const shownLabel = (raw: string): string => sanitizeLabel(raw) || 'private'

interface HiddenRun {
  run: TextRun
  owner: string
  label: string
}

interface HiddenPicture {
  key: string
  label: string
}

function paragraphRuns(
  paragraphs: readonly Paragraph[] | undefined,
  owner: string,
  out: HiddenRun[],
) {
  for (const p of paragraphs ?? []) {
    for (const run of p.runs) {
      if (run.redact) out.push({ run, owner, label: shownLabel(run.redact) })
    }
  }
}

function walk(el: SlideElement, slide: string, runs: HiddenRun[], pictures: HiddenPicture[]): void {
  const owner = `${slide}/${elementDurableId(el)}`
  switch (el.type) {
    case 'text':
    case 'shape':
      paragraphRuns(el.text?.paragraphs, owner, runs)
      break
    case 'table':
      el.rows.forEach((row, r) =>
        row.forEach((cell, c) => paragraphRuns(cell.text?.paragraphs, `${owner}/${r}.${c}`, runs)),
      )
      break
    case 'group':
      for (const child of el.children) walk(child, slide, runs, pictures)
      break
    case 'picture':
      if (el.redact) {
        const label = shownLabel(el.redact)
        pictures.push({
          label,
          key: JSON.stringify([owner, label, el.mediaRef, el.media?.target ?? null]),
        })
      }
      break
  }
}

function hiddenOf(opened: OpenedPptx): { runs: HiddenRun[]; pictures: HiddenPicture[] } {
  const runs: HiddenRun[] = []
  const pictures: HiddenPicture[] = []
  for (const slide of opened.deck.slides) {
    const id = slideDurableId(slide)
    for (const el of slide.elements) walk(el, id, runs, pictures)
  }
  return { runs, pictures }
}

export interface MaskedDeck {
  /** the words of every withheld run, in deck order */
  texts: string[]
  owners: string[]
  labels: string[]
  pictures: string[]
  /** every label the deck hides */
  all: string[]
}

/** Swap every withheld run's words for its marker; null when the deck withholds nothing. */
export function maskDeck(opened: OpenedPptx): MaskedDeck | null {
  const { runs, pictures } = hiddenOf(opened)
  if (!runs.length && !pictures.length) return null
  const texts = runs.map((h) => h.run.text)
  for (const h of runs) h.run.text = placeholderSource(h.label)
  return {
    texts,
    owners: runs.map((h) => h.owner),
    labels: runs.map((h) => h.label),
    pictures: pictures.map((p) => p.key),
    all: [...new Set([...runs.map((h) => h.label), ...pictures.map((p) => p.label)])],
  }
}

/** The labels an op removed, rewrote, copied or moved; null when the deck still holds them as masked. */
export function deckHidingViolation(opened: OpenedPptx, masked: MaskedDeck): string[] | null {
  const { runs, pictures } = hiddenOf(opened)
  const touched = new Set<string>()
  for (let i = 0; i < Math.max(runs.length, masked.labels.length); i++) {
    const now = runs[i]
    const label = masked.labels[i]
    if (
      !now ||
      label === undefined ||
      now.label !== label ||
      now.owner !== masked.owners[i] ||
      now.run.text !== placeholderSource(label)
    ) {
      if (label !== undefined) touched.add(label)
      if (now) touched.add(now.label)
    }
  }
  const keys = pictures.map((p) => p.key)
  for (let i = 0; i < Math.max(keys.length, masked.pictures.length); i++) {
    if (keys[i] !== masked.pictures[i]) {
      for (const p of pictures) touched.add(p.label)
      for (const key of masked.pictures) touched.add((JSON.parse(key) as string[])[1]!)
      break
    }
  }
  return touched.size ? [...touched] : null
}

/** Every marker gets its run's words back. Call only when no violation is left. */
export function unmaskDeck(opened: OpenedPptx, masked: MaskedDeck): void {
  const { runs } = hiddenOf(opened)
  if (runs.length !== masked.texts.length) {
    throw new Error('the hidden runs of the deck no longer line up; nothing was saved')
  }
  runs.forEach((h, i) => {
    h.run.text = masked.texts[i]!
  })
}

/** The labels hidden on one slide (0-based). */
export function slideHiddenLabels(opened: OpenedPptx, index: number): string[] {
  const slide = opened.deck.slides[index]
  if (!slide) return []
  const runs: HiddenRun[] = []
  const pictures: HiddenPicture[] = []
  for (const el of slide.elements) walk(el, slideDurableId(slide), runs, pictures)
  return [...new Set([...runs.map((h) => h.label), ...pictures.map((p) => p.label)])]
}
