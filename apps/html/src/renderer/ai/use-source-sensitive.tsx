import { useMemo, useRef } from 'react'
import type { Lang } from '@genoffice/i18n'
import { ATTACHMENT_IMAGE_EXTS, type AttachmentMeta } from '../../shared/ipc'
import type { HtmlDocAccess } from './tools'
import {
  hideSourceSpots,
  sourceLineCol,
  sourcePieces,
  type SourceSpotLocation,
} from './sensitive-source'
import { createSensitiveExclusionMemory, type SensitiveExclusionBridge } from './sensitive-find'
import { useSensitiveInfo, type SensitiveInfoController } from './use-sensitive-info'

/** Characters read per attachment slice (the main process caps a slice at this) */
const READ_SLICE = 48_000

/** An attachment's whole text, read through the same channel the model's read tool uses. */
export async function readWholeAttachment(path: string): Promise<string> {
  let text = ''
  for (let offset = 0; ;) {
    const r = await window.htmlApi.readAttachment(path, offset, READ_SLICE)
    if (!r.ok || typeof r.text !== 'string') return text
    text += r.text
    offset += r.text.length
    if (r.text.length === 0 || offset >= (r.totalChars ?? 0)) return text
  }
}

export interface SourceSensitiveArgs {
  lang: Lang
  localAi: boolean
  access: () => HtmlDocAccess
  /** "Ln {line}, Col {col}" in the screen language */
  position: (line: number, col: number) => string
  hide?: (from: number, to: number, label: string) => boolean
  reveal?: (from: number, to: number) => void
  /** the attachments of the request being checked */
  requestAttachments: () => readonly AttachmentMeta[]
}

/** "Find sensitive info" for the HTML editor's AI panel. */
export function useSourceSensitiveInfo(args: SourceSensitiveArgs): SensitiveInfoController {
  const argsRef = useRef(args)
  argsRef.current = args
  const memory = useMemo(() => {
    const api = window.htmlApi?.sensitiveExclusions
    const bridge: SensitiveExclusionBridge | null = api
      ? {
          get: (path) => api.get(path) as ReturnType<SensitiveExclusionBridge['get']>,
          add: (path, entry) => api.add(path, entry),
        }
      : null
    return createSensitiveExclusionMemory(bridge, () => argsRef.current.access().getFilePath())
  }, [])

  return useSensitiveInfo<SourceSpotLocation>({
    lang: args.lang,
    localAi: args.localAi,
    memory,
    collect: async () => {
      const access = argsRef.current.access()
      const source = access.getText()
      const { pieces, existingMarks } = sourcePieces(source, access.getMap())
      const hideable = !!argsRef.current.hide
      return {
        pieces: hideable
          ? pieces
          : pieces.map((p) => ({ ...p, unhideable: { reason: 'unsupported' as const } })),
        existingMarks,
        locationText: (loc) => {
          const { line, col } = sourceLineCol(source, loc.from)
          return argsRef.current.position(line, col)
        },
      }
    },
    hide: async (spots) => {
      const hide = argsRef.current.hide
      if (!hide) return
      hideSourceSpots(spots, () => argsRef.current.access().getText(), hide)
    },
    locate: (spot) =>
      argsRef.current.reveal?.(spot.location.from + spot.start, spot.location.from + spot.end),
    attachmentTexts: async () => {
      const list = argsRef.current
        .requestAttachments()
        .filter((a) => !ATTACHMENT_IMAGE_EXTS.has(a.ext))
      return Promise.all(list.map((a) => readWholeAttachment(a.path).catch(() => '')))
    },
  })
}
