import { useCallback, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import { detectSensitive } from '@genoffice/agent-core/sensitive-detect'
import { normalizeSensitiveValue, type SensitiveKind } from '@genoffice/agent-core/sensitive-kinds'
import type { SensitiveCandidateRow } from '@genoffice/ui'
import {
  candidateRows,
  findDocSensitive,
  type DocSensitiveCandidate,
  type DocSensitiveExtras,
  type DocSensitiveText,
} from './doc-sensitive'

/**
 * The Word editor's side of "find sensitive info": finding, the list rows,
 * hiding what the reader confirms (the editor's own `setRedaction` mark),
 * remembering what they dismiss, and the counts the first-send alert needs.
 */

export interface DocSensitiveSources {
  editor: Editor | null
  /** the document's path; null for a document never saved (dismissals last as long as the tab) */
  filePath: string | null
  lang: string
  text: DocSensitiveText
  /** headers, footers, notes and comments, read now */
  extras: () => DocSensitiveExtras
}

export interface DocSensitive {
  open: boolean
  busy: boolean
  rows: SensitiveCandidateRow[]
  /** open the list and find again */
  openList(): void
  close(): void
  confirm(ids: string[]): Promise<void>
  exclude(id: string): Promise<void>
  locate(id: string): void
  /** the first-send count of this document: candidates not hidden, not dismissed, plus the unhideable ones */
  countDocument(): Promise<number>
}

type Item = { kind: SensitiveKind; value: string }
type Found = { doc: PmNode; list: DocSensitiveCandidate[] }

const itemKey = (item: Item) =>
  `${item.kind}\u0000${normalizeSensitiveValue(item.kind, item.value)}`

/** how many characters of an attachment are asked for at once (the reader's own slice limit) */
const ATTACHMENT_SLICE = 48_000

export interface AttachmentReader {
  (
    path: string,
    offset: number,
    maxChars: number,
  ): Promise<{ ok: boolean; text?: string; totalChars?: number }>
}

/**
 * Candidates in the attachments of a request, read the way the AI reads them
 * (the hiding-aware file reader, so hidden spans are already placeholders). A
 * file that cannot be read counts nothing: the AI cannot read it either.
 */
export async function countAttachmentCandidates(
  paths: readonly string[],
  read: AttachmentReader,
): Promise<number> {
  let count = 0
  for (const path of paths) {
    let text = ''
    try {
      let offset = 0
      for (;;) {
        const slice = await read(path, offset, ATTACHMENT_SLICE)
        if (!slice.ok || typeof slice.text !== 'string') break
        text += slice.text
        offset += slice.text.length
        if (slice.text.length === 0 || offset >= (slice.totalChars ?? 0)) break
      }
    } catch {
      continue
    }
    if (!text) continue
    count += detectSensitive(
      text.split(/\r?\n/).map((line, i) => ({ text: line, location: i })),
    ).length
  }
  return count
}

export function useDocSensitive(sources: DocSensitiveSources): DocSensitive {
  const sourcesRef = useRef(sources)
  sourcesRef.current = sources
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState<SensitiveCandidateRow[]>([])
  /** the last find and the document it was made on */
  const foundRef = useRef<Found | null>(null)
  /** dismissals of this tab, kept even when the document has no path or the store fails */
  const dismissedRef = useRef(new Set<string>())
  const runRef = useRef(0)

  const isExcluded = useCallback(async (items: Item[]): Promise<boolean[]> => {
    const local = items.map((item) => dismissedRef.current.has(itemKey(item)))
    const path = sourcesRef.current.filePath
    if (!path || !window.desktop?.sensitiveExclusionCheck) return local
    try {
      const stored = await window.desktop.sensitiveExclusionCheck(path, items)
      return local.map((hit, i) => hit || stored[i] === true)
    } catch {
      return local
    }
  }, [])

  const find = useCallback(async (): Promise<Found | null> => {
    const { editor, lang, text, extras } = sourcesRef.current
    if (!editor || editor.isDestroyed) return null
    const doc = editor.state.doc
    const list = await findDocSensitive(doc, extras(), { lang, text, isExcluded })
    const found = { doc, list }
    foundRef.current = found
    return found
  }, [isExcluded])

  const refresh = useCallback(async () => {
    const run = ++runRef.current
    setBusy(true)
    try {
      const found = await find()
      if (run !== runRef.current) return
      setRows(found ? candidateRows(found.doc, found.list, sourcesRef.current.lang) : [])
    } finally {
      if (run === runRef.current) setBusy(false)
    }
  }, [find])

  /** the last find, made again when the document changed since */
  const current = useCallback(async () => {
    const editor = sourcesRef.current.editor
    const found = foundRef.current
    if (found && editor && found.doc === editor.state.doc) return found
    return find()
  }, [find])

  const confirm = useCallback(
    async (ids: string[]) => {
      const editor = sourcesRef.current.editor
      if (!editor || editor.isDestroyed || ids.length === 0) return
      const found = await current()
      if (!found || editor.state.doc !== found.doc) {
        // the document changed while finding: show the fresh list, hide nothing unseen
        await refresh()
        return
      }
      const { doc, list } = found
      const wanted = new Set(ids)
      const labels = new Map(
        candidateRows(doc, list, sourcesRef.current.lang).map((r) => [r.id, r.label]),
      )
      const targets = list.filter((c) => wanted.has(c.id) && c.hideable && c.range)
      if (targets.length > 0) {
        const { from, to } = editor.state.selection
        let chain = editor.chain()
        for (const c of targets) {
          const label = labels.get(c.id)
          if (!label || !c.range) continue
          chain = chain.setTextSelection(c.range).setRedaction(label)
        }
        chain.setTextSelection({ from, to }).run()
      }
      await refresh()
    },
    [current, refresh],
  )

  const exclude = useCallback(
    async (id: string) => {
      const found = foundRef.current
      const c = found?.list.find((x) => x.id === id)
      if (!c) return
      const item = { kind: c.kind, value: c.value }
      dismissedRef.current.add(itemKey(item))
      setRows((prev) => prev.filter((r) => r.id !== id))
      const path = sourcesRef.current.filePath
      if (path && window.desktop?.sensitiveExclusionAdd) {
        try {
          await window.desktop.sensitiveExclusionAdd(path, item)
        } catch {
          // remembered for this tab only
        }
      }
      await refresh()
    },
    [refresh],
  )

  const locate = useCallback((id: string) => {
    const editor = sourcesRef.current.editor
    const found = foundRef.current
    const c = found?.list.find((x) => x.id === id)
    if (!editor || editor.isDestroyed || !c?.range || found?.doc !== editor.state.doc) return
    editor.chain().focus().setTextSelection(c.range).scrollIntoView().run()
  }, [])

  const openList = useCallback(() => {
    setOpen(true)
    void refresh()
  }, [refresh])

  const close = useCallback(() => {
    runRef.current++
    setOpen(false)
    setBusy(false)
  }, [])

  const countDocument = useCallback(async () => (await find())?.list.length ?? 0, [find])

  return { open, busy, rows, openList, close, confirm, exclude, locate, countDocument }
}
