import { useMemo, useRef } from 'react'
import type { Lang } from '@genoffice/i18n'
import type { RenderSlide } from '@genoffice/pptx-render'
import { ATTACHMENT_IMAGE_EXTS, type AttachmentMeta } from '../../shared/ipc'
import type { SlidesSensitiveText } from '../../shared/sensitive-text'
import type { TFunc } from '../i18n/locale'
import {
  deckHideOps,
  deckLocationText,
  deckPieces,
  deckSpotBlocked,
  type DeckPieceWords,
  type DeckSpotLocation,
} from './sensitive-deck'
import {
  createSensitiveExclusionMemory,
  type SensitiveExclusionBridge,
  type SensitiveSpot,
} from './sensitive-find'
import { useSensitiveInfo, type SensitiveInfoController } from './use-sensitive-info'

/** Ops per transaction the main process takes at most */
const TXN_LIMIT = 50
/** Characters read per attachment slice (the main process caps a slice at this) */
const READ_SLICE = 48_000

/** An attachment's whole text, read through the same channel the model's read tool uses. */
export async function readWholeAttachment(path: string): Promise<string> {
  let text = ''
  for (let offset = 0; ;) {
    const r = await window.desktop.readAttachment(path, offset, READ_SLICE)
    if (!r.ok || typeof r.text !== 'string') return text
    text += r.text
    offset += r.text.length
    if (r.text.length === 0 || offset >= (r.totalChars ?? 0)) return text
  }
}

export interface DeckSensitiveArgs {
  lang: Lang
  t: TFunc
  localAi: boolean
  filePath: () => string | null | undefined
  /** the deck after a hide, and the page to show */
  applyDeck: (slides: RenderSlide[], goTo?: number) => void
  goTo: (slide: number) => void
  /** the attachments of the request being checked */
  requestAttachments: () => readonly AttachmentMeta[]
}

/** "Find sensitive info" for the deck editor's AI panel. */
export function useDeckSensitiveInfo(args: DeckSensitiveArgs): SensitiveInfoController {
  const argsRef = useRef(args)
  argsRef.current = args
  const foundTextRef = useRef<SlidesSensitiveText | null>(null)
  const memory = useMemo(() => {
    const api = window.slidesApi?.sensitiveExclusions
    const bridge: SensitiveExclusionBridge | null = api
      ? {
          get: (path) => api.get(path) as ReturnType<SensitiveExclusionBridge['get']>,
          add: (path, entry) => api.add(path, entry),
        }
      : null
    return createSensitiveExclusionMemory(bridge, () => argsRef.current.filePath())
  }, [])

  const words = (): DeckPieceWords => {
    const { t } = argsRef.current
    return {
      slide: (n) => t('aiScopeSlide', { n }),
      notes: t('appNotesLabel'),
      table: t('paneSelKindTable'),
      comment: t('ribbonComment'),
    }
  }

  return useSensitiveInfo<DeckSpotLocation>({
    lang: args.lang,
    localAi: args.localAi,
    memory,
    collect: async () => {
      const text = await window.slidesApi.sensitiveText()
      if (!text) return null
      foundTextRef.current = text
      const w = words()
      const { pieces, existingMarks } = deckPieces(text, w)
      return {
        pieces,
        existingMarks,
        locationText: (loc) => deckLocationText(loc, w),
        blocked: (loc, start, end) =>
          deckSpotBlocked(text, loc, start, end) ? { reason: 'unsupported' } : undefined,
      }
    },
    hide: async (spots: SensitiveSpot<DeckSpotLocation>[]) => {
      const found = foundTextRef.current
      const now = await window.slidesApi.sensitiveText()
      if (!found || !now) return
      const { ops } = deckHideOps(now, found, spots)
      let last: RenderSlide[] | undefined
      for (let i = 0; i < ops.length; i += TXN_LIMIT) {
        const result = await window.slidesApi.applyTxn({ ops: ops.slice(i, i + TXN_LIMIT) })
        if (result?.applied && result.slides) last = result.slides
      }
      if (last) {
        const first = spots[0]?.location
        argsRef.current.applyDeck(last, first ? first.slide : undefined)
      }
    },
    locate: (spot) => argsRef.current.goTo(spot.location.slide),
    attachmentTexts: async () => {
      const list = argsRef.current
        .requestAttachments()
        .filter((a) => !ATTACHMENT_IMAGE_EXTS.has(a.ext))
      return Promise.all(list.map((a) => readWholeAttachment(a.path).catch(() => '')))
    },
  })
}
