/**
 * The HWP reading layout (page or flow) last chosen for each document, so a
 * document opens the way the user left it (design system 5.3). Kept in the
 * WebView's local storage, newest last, for the most recent documents only.
 */
export type HwpLayout = 'page' | 'flow'

const STORAGE_KEY = 'ieum.mobile.hwpLayout'
/** How many documents to remember; older ones fall back to the window default. */
const REMEMBERED_DOCS = 200

type Entries = Array<[string, HwpLayout]>

function read(storage: Storage): Entries {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is [string, HwpLayout] =>
        Array.isArray(entry) &&
        typeof entry[0] === 'string' &&
        (entry[1] === 'page' || entry[1] === 'flow'),
    )
  } catch {
    return []
  }
}

export function rememberedLayout(storage: Storage, docKey: string): HwpLayout | null {
  return read(storage).find(([key]) => key === docKey)?.[1] ?? null
}

export function rememberLayout(storage: Storage, docKey: string, layout: HwpLayout): void {
  const entries = read(storage).filter(([key]) => key !== docKey)
  entries.push([docKey, layout])
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-REMEMBERED_DOCS)))
  } catch {
    // storage full or unavailable: the window default applies next time
  }
}
