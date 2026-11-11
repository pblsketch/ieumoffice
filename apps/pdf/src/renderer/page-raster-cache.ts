interface Entry {
  owner: object
  key: string
  canvas: HTMLCanvasElement
  bytes: number
}

/** Reconstructible display pixels only; document models and edit history stay with their owners. */
export class PageRasterCache {
  private entries = new Map<Entry, true>()
  private owners = new WeakMap<object, Map<string, Entry>>()
  private closed = new WeakSet<object>()
  private retained = new WeakSet<HTMLCanvasElement>()
  private bytes = 0

  constructor(private readonly budget = 16 * 1024 * 1024) {}

  holds(canvas: HTMLCanvasElement): boolean {
    return this.retained.has(canvas)
  }

  take(owner: object, key: string): HTMLCanvasElement | undefined {
    const entry = this.owners.get(owner)?.get(key)
    if (!entry) return
    this.remove(entry, false)
    return entry.canvas
  }

  put(owner: object, key: string, canvas: HTMLCanvasElement): void {
    canvas.remove()
    const bytes = canvas.width * canvas.height * 4
    if (!key || this.closed.has(owner) || !bytes || bytes > this.budget) {
      canvas.width = canvas.height = 0
      return
    }
    let slots = this.owners.get(owner)
    if (!slots) this.owners.set(owner, (slots = new Map()))
    const previous = slots.get(key)
    if (previous) this.remove(previous, true)
    const entry = { owner, key, canvas, bytes }
    slots.set(key, entry)
    this.entries.set(entry, true)
    this.retained.add(canvas)
    this.bytes += bytes
    while (this.bytes > this.budget) this.remove(this.entries.keys().next().value!, true)
  }

  close(owner: object): void {
    this.closed.add(owner)
    this.clear(owner)
  }

  clear(owner: object): void {
    for (const entry of this.owners.get(owner)?.values() ?? []) this.remove(entry, true)
    this.owners.delete(owner)
  }

  private remove(entry: Entry, release: boolean): void {
    this.entries.delete(entry)
    this.retained.delete(entry.canvas)
    this.owners.get(entry.owner)?.delete(entry.key)
    this.bytes -= entry.bytes
    if (release) entry.canvas.width = entry.canvas.height = 0
  }
}

/** One budget across all PDF documents in this renderer, including replacement documents. */
export const pageRasterCache = new PageRasterCache()
