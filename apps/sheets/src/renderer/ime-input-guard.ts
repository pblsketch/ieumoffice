/**
 * Windows Korean IME's Hanja picker (typing a consonant and then Hanja to pick
 * a special character) can end the composition with the consonant and then
 * deliver one more plain input event that carries the same text. Univer's
 * hidden editor already inserted the composition text from `compositionend`,
 * so the trailing `input` inserts it a second time and the consonant appears
 * twice. The cell editor, formula bar and name box all use this hidden editor,
 * while the other editors in the app do not — which is why the report was
 * Sheets-only.
 *
 * Swallow exactly that trailing event: same text, no new composition, key or
 * paste in between, and within a bounded window. A real keystroke always has a
 * keydown first, which clears the pending commit.
 */
import { DocSelectionRenderService } from '@univerjs/docs-ui'

/// The IME's trailing input arrives in the same commit, but a busy workbook can
/// delay the event; a real key, composition, paste or drop cancels it earlier.
export const IME_DUPLICATE_INPUT_WINDOW_MS = 2_000

/// Whether a plain input repeats the text a composition just committed.
export function imeInputRepeatsCommit(
  committed: string,
  inputText: string,
  elapsedMs: number,
): boolean {
  return (
    committed.length > 0 &&
    inputText === committed &&
    elapsedMs >= 0 &&
    elapsedMs <= IME_DUPLICATE_INPUT_WINDOW_MS
  )
}

interface SelectionRenderServiceInternals {
  _initInputEvents?: () => void
  _input?: HTMLElement
}

let installed = false

/// Must run before Univer constructs its selection service, so the guard's
/// listeners are registered ahead of the service's own input handlers.
export function installImeInputGuard(): void {
  if (installed) return
  installed = true

  const proto = DocSelectionRenderService.prototype as unknown as SelectionRenderServiceInternals
  const initInputEvents = proto._initInputEvents
  if (typeof initInputEvents !== 'function') return

  proto._initInputEvents = function (this: SelectionRenderServiceInternals): void {
    const input = this._input
    if (input) {
      let committed: string[] = []
      let committedAt = 0
      const clearCommit = (): void => {
        committed = []
      }

      input.addEventListener(
        'compositionend',
        (event) => {
          const data = (event as CompositionEvent).data || ''
          const domText = input.textContent || ''
          committed = [...new Set([data, domText].filter((text) => text.length > 0))]
          committedAt = performance.now()
        },
        true,
      )
      input.addEventListener(
        'keydown',
        (event) => {
          // Keys that belong to the IME (candidate list navigation, the Hanja
          // key itself) must not cancel the commit we are watching for.
          const key = event as KeyboardEvent
          if (key.isComposing || key.keyCode === 229) return
          clearCommit()
        },
        true,
      )
      input.addEventListener('compositionstart', clearCommit, true)
      input.addEventListener('paste', clearCommit, true)
      input.addEventListener('drop', clearCommit, true)
      input.addEventListener(
        'input',
        (event) => {
          if (committed.length === 0) return
          const text = (event as InputEvent).data ?? input.textContent ?? ''
          const pending = committed
          committed = []
          const repeats = pending.some((textBefore) =>
            imeInputRepeatsCommit(textBefore, text, performance.now() - committedAt),
          )
          if (!repeats) return
          // The compositionend handler already inserted this text; keep
          // Univer's input handler (and anything after it) from inserting it
          // again, and leave the hidden editor empty as that handler does.
          event.stopImmediatePropagation()
          input.textContent = ''
        },
        true,
      )
    }
    initInputEvents.call(this)
  }
}
