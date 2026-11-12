import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import {
  SensitiveCandidateList,
  SensitiveFindButton,
  createSensitiveSendCheck,
  useSensitiveSendAlert,
  type SensitiveCandidateRow,
  type SensitiveSendAnswer,
} from '@genoffice/ui'
import {
  countSensitiveText,
  findSensitive,
  type FindSensitiveOptions,
  type SensitiveExclusionMemory,
  type SensitiveFound,
  type SensitiveSpot,
} from './sensitive-find'

/**
 * "Find sensitive info" wired into an AI panel: the button, the candidate
 * list, and the alert before the tab's first send. The editor says how to read
 * its document (`collect`) and how to hide confirmed spots (`hide`); this
 * keeps the list, remembers exclusions and counts for the alert.
 */

/** One per tab: the panel may mount again, the first-send answer must not be forgotten. */
const TAB_SEND_CHECK = createSensitiveSendCheck()

export type SensitiveCollect<L> = () => Promise<Omit<
  FindSensitiveOptions<L>,
  'lang' | 'isExcluded'
> | null>

export interface SensitiveInfoArgs<L> {
  lang: Lang
  localAi: boolean
  collect: SensitiveCollect<L>
  /** hide these spots with the editor's own command; resolves when the document has them */
  hide: (spots: SensitiveSpot<L>[]) => Promise<void>
  memory: SensitiveExclusionMemory
  locate?: (spot: SensitiveSpot<L>) => void
  /** the text of this request's attachments, read the way the model would read them */
  attachmentTexts?: () => Promise<string[]>
}

export interface SensitiveInfoController {
  /** the "find sensitive info" button */
  button: React.JSX.Element
  /** the open list or the first-send alert, to place above the composer; null when neither shows */
  panel: React.JSX.Element | null
  /** await before a send: `send` lets it out, `review` keeps the composer and opens the list */
  beforeSend: () => Promise<SensitiveSendAnswer>
  /** whether the tab's first send has been answered (nothing more to ask) */
  settled: () => boolean
}

export function useSensitiveInfo<L>(args: SensitiveInfoArgs<L>): SensitiveInfoController {
  const argsRef = useRef(args)
  argsRef.current = args
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState<SensitiveCandidateRow[]>([])
  const [attachmentCount, setAttachmentCount] = useState(0)
  const foundRef = useRef<SensitiveFound<L> | null>(null)
  const runRef = useRef(0)
  const alive = useRef(true)
  useEffect(
    () => () => {
      alive.current = false
    },
    [],
  )
  const alert = useSensitiveSendAlert({
    lang: args.lang,
    localAi: args.localAi,
    check: TAB_SEND_CHECK,
  })

  const find = useCallback(async (): Promise<SensitiveFound<L>> => {
    const a = argsRef.current
    const options = await a.collect()
    if (!options) return { rows: [], spots: new Map() }
    return findSensitive({
      ...options,
      lang: a.lang,
      isExcluded: (kind, value) => a.memory.isExcluded(kind, value),
    })
  }, [])

  const refresh = useCallback(async () => {
    const run = ++runRef.current
    setBusy(true)
    try {
      const found = await find()
      if (!alive.current || run !== runRef.current) return
      foundRef.current = found
      setRows(found.rows)
    } finally {
      if (alive.current && run === runRef.current) setBusy(false)
    }
  }, [find])

  const openList = useCallback(
    (attachments = 0) => {
      setAttachmentCount(attachments)
      setOpen(true)
      void refresh().catch(() => setBusy(false))
    },
    [refresh],
  )

  const confirm = useCallback(
    async (ids: string[]) => {
      const found = foundRef.current
      if (!found) return
      const spots = ids.flatMap((id) => {
        const spot = found.spots.get(id)
        return spot && spot.hideable ? [spot] : []
      })
      if (spots.length === 0) return
      await argsRef.current.hide(spots).catch(() => undefined)
      await refresh().catch(() => undefined)
    },
    [refresh],
  )

  const exclude = useCallback(
    async (id: string) => {
      const spot = foundRef.current?.spots.get(id)
      if (!spot) return
      setRows((cur) => cur.filter((r) => r.id !== id))
      await argsRef.current.memory.exclude(spot.kind, spot.value).catch(() => undefined)
      await refresh().catch(() => undefined)
    },
    [refresh],
  )

  const countAttachments = useCallback(async (): Promise<number> => {
    const texts = (await argsRef.current.attachmentTexts?.()) ?? []
    return texts.reduce((n, text) => n + countSensitiveText(text), 0)
  }, [])

  const beforeSend = useCallback(async (): Promise<SensitiveSendAnswer> => {
    let attachments = 0
    const answer = await alert.beforeSend(async () => {
      const [found, att] = await Promise.all([find(), countAttachments()])
      attachments = att
      return { documentCount: found.rows.length, attachmentCount: att }
    })
    if (answer === 'review' && alive.current) openList(attachments)
    return answer
  }, [alert, countAttachments, find, openList])

  const button = (
    <SensitiveFindButton
      lang={args.lang}
      busy={busy && open}
      onClick={() => (open ? setOpen(false) : openList(0))}
    />
  )

  const panel = alert.alert ? (
    alert.alert
  ) : open ? (
    <SensitiveCandidateList
      lang={args.lang}
      candidates={rows}
      busy={busy}
      attachmentCount={attachmentCount}
      onConfirm={(ids) => void confirm(ids)}
      onExclude={(id) => void exclude(id)}
      onLocate={
        args.locate
          ? (id) => {
              const spot = foundRef.current?.spots.get(id)
              if (spot) argsRef.current.locate?.(spot)
            }
          : undefined
      }
      onClose={() => setOpen(false)}
    />
  ) : null

  return { button, panel, beforeSend, settled: () => TAB_SEND_CHECK.settled }
}
