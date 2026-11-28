/**
 * Finishing a Korean (IME) composition before a keyboard-bar command
 * (design system 5.4). Univer's cell editor ignores input while a
 * composition is open (`_isIMEInputApply`) and reads the committed text at
 * `compositionend`, so a key typed or a confirm sent mid-syllable would lose
 * or split the syllable. The bar's buttons keep the focus (`pointerdown`
 * preventDefault), which also keeps the composition open; this commits it
 * first.
 */

/** If the IME never reports the end, the command still runs after this (ms). */
export const COMPOSITION_END_WAIT_MS = 400

export interface CompositionTracker {
  readonly composing: boolean
  /**
   * Runs `action` now when nothing is being composed; otherwise asks the IME
   * to commit (blur and focus the editor input, which ends a composition in
   * every engine and does not close Univer's sheet editor) and runs it at
   * `compositionend`, or after a short wait if none comes.
   */
  afterComposition(action: () => void): void
  dispose(): void
}

export function createCompositionTracker(doc: Document = document): CompositionTracker {
  let composing = false
  let pending: (() => void)[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = null
    const actions = pending
    pending = []
    for (const action of actions) action()
  }
  const onStart = () => {
    composing = true
  }
  const onEnd = () => {
    composing = false
    // Let the editor take the committed text first (its own compositionend).
    if (pending.length > 0) queueMicrotask(flush)
  }
  doc.addEventListener('compositionstart', onStart, true)
  doc.addEventListener('compositionend', onEnd, true)

  return {
    get composing() {
      return composing
    },
    afterComposition(action) {
      if (!composing) {
        action()
        return
      }
      pending.push(action)
      if (timer) return
      timer = setTimeout(() => {
        composing = false
        flush()
      }, COMPOSITION_END_WAIT_MS)
      const input = doc.activeElement
      if (input instanceof HTMLElement) {
        input.blur()
        input.focus({ preventScroll: true })
      }
    },
    dispose() {
      if (timer) clearTimeout(timer)
      timer = null
      pending = []
      doc.removeEventListener('compositionstart', onStart, true)
      doc.removeEventListener('compositionend', onEnd, true)
    },
  }
}
