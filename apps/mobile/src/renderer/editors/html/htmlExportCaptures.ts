// What the phone's HTML export writes where html2docx wanted a picture it cannot capture (spec 5.7).
// The converter marks some blocks for capture whole (a gradient banner with its heading in it);
// with no capture its Word generator writes the node's `fallbackText`, or else the English
// "Unavailable embedded content". These functions change only the extracted intent tree (IR),
// only for a capture that failed, so the generator keeps that block's words instead:
// - a captured block: `fallbackText` = its visible text, else a short marker in the screen
//   language; a later slice of the same tall block gets an empty line (its text went with the
//   first slice);
// - a captured inline label: its words become the run's text (an inline picture without words is
//   left out, as the converter does).
// A capture that succeeds is not touched: the picture is used as before.

/** A no-break space: a blank line in Word where a later slice of a block was. */
const BLANK = '\u00a0'

type IrObject = Record<string, unknown>

function isObject(value: unknown): value is IrObject {
  return typeof value === 'object' && value !== null
}

interface ClipRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

function clipOf(node: IrObject): ClipRect | null {
  const clip = node.clip
  if (!isObject(clip)) return null
  const { x, y, width, height } = clip
  return typeof x === 'number' &&
    typeof y === 'number' &&
    typeof width === 'number' &&
    typeof height === 'number'
    ? { x, y, width, height }
    : null
}

/** Every object of the tree, with the array (and index) it sits in when it sits in one. */
function walk(
  tree: unknown,
  visit: (node: IrObject, siblings: readonly unknown[] | null, index: number) => void,
): void {
  const seen = new WeakSet<object>()
  const step = (value: unknown, siblings: readonly unknown[] | null, index: number) => {
    if (!isObject(value) || seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) {
      value.forEach((item, i) => step(item, value, i))
      return
    }
    visit(value, siblings, index)
    for (const child of Object.values(value)) step(child, null, -1)
  }
  step(tree, null, -1)
}

/**
 * The capture each clip rectangle of the tree belongs to. The converter hands a node's own `clip`
 * object to `screenshot`, so the object itself names the capture.
 */
export function clipOwners(ir: unknown): Map<object, string> {
  const owners = new Map<object, string>()
  walk(ir, (node) => {
    if (typeof node.shotId === 'string' && isObject(node.clip)) owners.set(node.clip, node.shotId)
  })
  return owners
}

/** `[data-h2d-id="h2d-3"]` → `h2d-3`; the converter's selector for one capture. */
export function shotIdOfSelector(selector: string): string | null {
  return /^\[data-h2d-id="([^"\\]+)"\]$/.exec(selector)?.[1] ?? null
}

/** An element's words as one line (what the reader sees, whitespace collapsed). */
export function visibleText(element: Element | null): string {
  if (!element) return ''
  const text = (element as HTMLElement).innerText ?? element.textContent ?? ''
  return text.replace(/\s+/g, ' ').trim()
}

/** The node right before `index` continues into this one: a later slice of one tall block. */
function continuesSlice(node: IrObject, siblings: readonly unknown[] | null, index: number) {
  const clip = clipOf(node)
  const previous = siblings && index > 0 ? siblings[index - 1] : null
  if (!clip || !isObject(previous) || previous.type !== 'image') return false
  const before = clipOf(previous)
  return (
    before !== null &&
    before.x === clip.x &&
    before.width === clip.width &&
    before.y + before.height === clip.y
  )
}

/**
 * The capture `shotId` failed: its nodes keep their words. `text` is the captured element's
 * visible text, '' when it has none or there is no element (`hasElement` false). `marker` stands
 * where there are no words at all. Returns how many nodes changed.
 */
export function keepCapturedText(
  ir: unknown,
  shotId: string,
  text: string,
  hasElement: boolean,
  marker: string,
): number {
  let changed = 0
  walk(ir, (node, siblings, index) => {
    if (node.shotId !== shotId) return
    if (node.inlineImage === true) {
      if (!text) return
      node.text = text
      node.inlineImage = false
      changed++
      return
    }
    if (node.type !== 'image') return
    // the converter's own words (an embed's title, a link) stay
    if (node.fallbackText || node.href) return
    node.fallbackText =
      text || (!hasElement && continuesSlice(node, siblings, index) ? BLANK : marker)
    changed++
  })
  return changed
}
