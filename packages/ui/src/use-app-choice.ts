import { useEffect, useState } from 'react'

/**
 * Which editors are on and whether AI features are on, as a screen sees it.
 * The shape mirrors `AppChoice` in @genoffice/electron-utils/app-choice (this
 * package does not depend on the preload-side package); any bridge exposed
 * as `window.aiOfficeEditorChoice` fits `AppChoiceSource`.
 */
export interface AppChoiceState {
  /** item ids turned off (docs, sheets, slides, pdf, pdfTools, markdown, html, mindmap, diagram, hwp, epub) */
  off: readonly string[]
  aiFeatures: boolean
  /** true once an administrator policy locks the choice (never yet) */
  locked: boolean
}

export interface AppChoiceSource {
  get(): Promise<AppChoiceState>
  onChange(listener: (choice: AppChoiceState) => void): () => void
}

export const ALL_ON_APP_CHOICE_STATE: AppChoiceState = Object.freeze({
  off: Object.freeze([]) as readonly string[],
  aiFeatures: true,
  locked: false,
})

/** whether a screen shows its AI parts */
export function aiVisible(state: AppChoiceState): boolean {
  return state.aiFeatures
}

/**
 * The choice that applies, kept current. Until the first answer arrives (and
 * with no source, an editor running on its own, or a failing one) it is
 * everything on and AI on: screens look as they did before this setting
 * existed, and the main process refuses AI runs while AI is off anyway. A
 * change heard before the first answer wins over that answer.
 */
export function useAppChoice(source: AppChoiceSource | undefined): AppChoiceState {
  const [state, setState] = useState<AppChoiceState>(ALL_ON_APP_CHOICE_STATE)

  useEffect(() => {
    if (!source) return
    let alive = true
    let heard = false
    const unsubscribe = source.onChange((choice) => {
      heard = true
      if (alive) setState(choice)
    })
    source.get().then(
      (choice) => {
        if (alive && !heard) setState(choice)
      },
      () => {
        // no shell answering: stay with everything on
      },
    )
    return () => {
      alive = false
      unsubscribe()
    }
  }, [source])

  return state
}
