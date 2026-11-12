import { useMemo, useRef } from 'react'
import type { Editor } from '@tiptap/core'
import type { Lang } from '@genoffice/i18n'
import {
  docPieces,
  hideDocSpots,
  locateDocSpot,
  type DocSpotLocation,
} from '../editor/sensitive-doc'
import { createSensitiveExclusionMemory, type SensitiveExclusionBridge } from './sensitive-find'
import { useSensitiveInfo, type SensitiveInfoController } from './use-sensitive-info'

export interface DocSensitiveArgs {
  lang: Lang
  localAi: boolean
  getEditor: () => Editor | null
  filePath: () => string | null | undefined
  /** the "Start of document" word, for a spot above the first heading */
  startWord: () => string
}

/** "Find sensitive info" for the Markdown editor's AI panel. */
export function useDocSensitiveInfo(args: DocSensitiveArgs): SensitiveInfoController {
  const argsRef = useRef(args)
  argsRef.current = args
  const memory = useMemo(() => {
    const api = window.markdownApi?.sensitiveExclusions
    const bridge: SensitiveExclusionBridge | null = api
      ? {
          get: (path) => api.get(path) as ReturnType<SensitiveExclusionBridge['get']>,
          add: (path, entry) => api.add(path, entry),
        }
      : null
    return createSensitiveExclusionMemory(bridge, () => argsRef.current.filePath())
  }, [])

  return useSensitiveInfo<DocSpotLocation>({
    lang: args.lang,
    localAi: args.localAi,
    memory,
    collect: async () => {
      const editor = argsRef.current.getEditor()
      if (!editor) return null
      const { pieces, existingMarks } = docPieces(editor.state.doc)
      const start = argsRef.current.startWord()
      return {
        pieces,
        existingMarks,
        locationText: (loc) => loc.heading ?? start,
      }
    },
    hide: async (spots) => {
      const editor = argsRef.current.getEditor()
      if (editor) hideDocSpots(editor, spots)
    },
    locate: (spot) => {
      const editor = argsRef.current.getEditor()
      if (editor) locateDocSpot(editor, spot)
    },
  })
}
