/**
 * The person's side of sensitive-info hiding in the spreadsheet editor:
 *
 * - the "Hide sensitive info" / "Stop hiding" entries of the cell and header
 *   menus and the label dialog they open;
 * - "Find sensitive info" and its candidate list (rules only, on this PC), with
 *   the exclusion memory;
 * - the alert before the tab's first AI send.
 *
 * App.tsx forwards the menu commands here, renders `element` (the dialog) at
 * its root and `panel` above the AI composer, and awaits `beforeSend` in its
 * send path. The hook lives as long as the tab, so the first-send check does.
 */
import React, { useRef, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import { parseHidingName } from '@genoffice/agent-core/hiding-name'
import { detectSensitive } from '@genoffice/agent-core/sensitive-detect'
import { sensitiveKindName } from '@genoffice/agent-core/sensitive-kinds'
import {
  SensitiveCandidateList,
  SensitiveFindButton,
  SensitiveLabelDialog,
  createSensitiveSendCheck,
  useSensitiveSendAlert,
  type SensitiveSendAnswer,
} from '@genoffice/ui'
import { columnLabel } from '@genoffice/xlsx-gateway/domain/cell-address'
import type { CellScalar } from '@genoffice/xlsx-gateway/domain/workbook.types'
import { ATTACHMENT_IMAGE_EXTS, type AttachmentMeta } from '../../shared/desktop-api'
import type { WorkbookReadContext } from '../ai/workbook-readers'
import { t } from '../i18n/locale'
import type { UniverRuntime } from '../univer-state'
import {
  createHidingMark,
  hideTargetOf,
  removeHiding,
  selectedAreas,
  type HideTarget,
} from './actions'
import { findSheetCandidates, gatherFindInput, type SheetCandidate } from './find'
import { normalizeAreas } from './follow'
import { HIDING_MAX_ROW, type HidingArea } from './marks'

export const SENSITIVE_HIDE_COMMAND = 'sensitive-hide'
export const SENSITIVE_UNHIDE_COMMAND = 'sensitive-unhide'

/** "B2:B", "C3:D9" — how the status line names an area */
export function areaText(area: HidingArea): string {
  const from = `${columnLabel(area.startColumn)}${area.startRow + 1}`
  const to =
    area.endRow >= HIDING_MAX_ROW
      ? columnLabel(area.endColumn)
      : `${columnLabel(area.endColumn)}${area.endRow + 1}`
  return from === to ? from : `${from}:${to}`
}

const ATTACHMENT_READ_CHARS = 200_000

/** Candidates in the attachments of a request, read through the hiding-aware file reader. */
export async function countAttachmentCandidates(
  attachments: readonly AttachmentMeta[],
  read: (
    path: string,
    offset: number,
    maxChars: number,
  ) => Promise<{
    ok: boolean
    text?: string | undefined
    totalChars?: number | undefined
  }> = (path, offset, maxChars) => window.desktopApi.readAttachment(path, offset, maxChars),
): Promise<number> {
  let count = 0
  for (const attachment of attachments) {
    if (ATTACHMENT_IMAGE_EXTS.has(attachment.ext)) continue
    let offset = 0
    for (;;) {
      const result = await read(attachment.path, offset, ATTACHMENT_READ_CHARS)
      if (!result.ok || !result.text) break
      const lines = result.text.split('\n').map((text, index) => ({ text, location: index }))
      count += detectSensitive(lines).length
      offset += result.text.length
      if (offset >= (result.totalChars ?? 0)) break
    }
  }
  return count
}

export interface SheetHidingUiArgs {
  readonly univerRef: { readonly current: UniverRuntime | null }
  readonly lang: Lang
  readonly setMessage: (message: string) => void
  /** a column's top cells (row 0 first), loaded if the workbook streams */
  readonly readColumn: (
    sheetId: string,
    column: number,
  ) => Promise<readonly (CellScalar | undefined)[]>
  readonly readContext: () => WorkbookReadContext
  /** the open workbook's session, for the exclusion memory; null for none */
  readonly sessionId: () => string | null
  /** the chosen AI runs on this PC */
  readonly localAi: boolean
}

export interface SheetHidingUi {
  /** runs a menu command; false when the command is not one of these */
  readonly command: (command: string) => boolean
  /** the label dialog while it is open */
  readonly element: React.JSX.Element | null
  /** the find button, candidate list and send alert, placed above the AI composer */
  readonly panel: React.JSX.Element
  /** hide areas under a label */
  readonly hide: (areas: readonly HidingArea[], label: string) => string | null
  /** before the tab's first send: `send`, or `review` (send nothing, the list opens) */
  readonly beforeSend: (attachments: readonly AttachmentMeta[]) => Promise<SensitiveSendAnswer>
}

interface ListState {
  readonly busy: boolean
  readonly candidates: readonly SheetCandidate[]
  readonly attachmentCount: number
}

export function useSheetHiding(args: SheetHidingUiArgs): SheetHidingUi {
  const [pending, setPending] = useState<HideTarget | null>(null)
  const [list, setList] = useState<ListState | null>(null)
  const [check] = useState(createSensitiveSendCheck)
  /** dismissed this session (also kept for workbooks with no file to remember them under) */
  const [dismissed] = useState(() => new Set<string>())
  const alert = useSensitiveSendAlert({ lang: args.lang, localAi: args.localAi, check })
  const argsRef = useRef(args)
  argsRef.current = args

  const hide = (areas: readonly HidingArea[], label: string): string | null => {
    const { univerRef, lang, setMessage } = argsRef.current
    const runtime = univerRef.current
    if (!runtime) return null
    const name = createHidingMark(runtime, areas, label, lang)
    if (name) {
      setMessage(
        t('appSensitiveHidden', {
          range: areas.map(areaText).join(', '),
          marker: `{{${parseHidingName(name)?.label ?? label}}}`,
        }),
      )
    }
    return name
  }

  /** the workbook's candidates, minus what was dismissed before */
  const findCandidates = async (): Promise<SheetCandidate[]> => {
    const { readContext, lang, sessionId } = argsRef.current
    const found = findSheetCandidates(await gatherFindInput(readContext()), lang)
    const fresh = found.filter(
      (candidate) => !dismissed.has(`${candidate.kind}\u0000${candidate.value}`),
    )
    const session = sessionId()
    if (!session || fresh.length === 0) return fresh
    try {
      const excluded = await window.desktopApi.sensitiveExclusionsFilter(
        session,
        fresh.map((candidate) => ({ kind: candidate.kind, value: candidate.value })),
      )
      return fresh.filter((_, index) => !excluded[index])
    } catch {
      return fresh
    }
  }

  const openList = (attachmentCount = 0, known?: readonly SheetCandidate[]): void => {
    if (known) {
      setList({ busy: false, candidates: known, attachmentCount })
      return
    }
    setList({ busy: true, candidates: [], attachmentCount })
    void findCandidates().then(
      (candidates) => setList({ busy: false, candidates, attachmentCount }),
      () => setList({ busy: false, candidates: [], attachmentCount }),
    )
  }

  const confirm = (ids: string[]): void => {
    const current = list?.candidates ?? []
    const chosen = current.filter(
      (candidate) => ids.includes(candidate.row.id) && candidate.row.hideable,
    )
    // a column is a mark of its own; scattered cells make one mark per kind
    for (const candidate of chosen.filter((entry) => entry.column)) {
      hide(candidate.areas, candidate.row.label)
    }
    const byKind = new Map<string, HidingArea[]>()
    for (const candidate of chosen.filter((entry) => !entry.column)) {
      byKind.set(candidate.kind, [...(byKind.get(candidate.kind) ?? []), ...candidate.areas])
    }
    for (const [kind, areas] of byKind) {
      hide(
        normalizeAreas(areas),
        sensitiveKindName(kind as SheetCandidate['kind'], argsRef.current.lang),
      )
    }
    const gone = new Set(chosen.map((candidate) => candidate.row.id))
    setList((state) =>
      state ? { ...state, candidates: state.candidates.filter((c) => !gone.has(c.row.id)) } : state,
    )
  }

  const exclude = (id: string): void => {
    const candidate = list?.candidates.find((entry) => entry.row.id === id)
    if (!candidate) return
    dismissed.add(`${candidate.kind}\u0000${candidate.value}`)
    const session = argsRef.current.sessionId()
    if (session) {
      void window.desktopApi
        .sensitiveExclusionAdd(session, { kind: candidate.kind, value: candidate.value })
        .catch(() => {})
    }
    setList((state) =>
      state ? { ...state, candidates: state.candidates.filter((c) => c.row.id !== id) } : state,
    )
  }

  const locate = (id: string): void => {
    const area = list?.candidates.find((entry) => entry.row.id === id)?.areas[0]
    const workbook = argsRef.current.univerRef.current?.univerAPI.getActiveWorkbook()
    const sheet = area ? workbook?.getSheetBySheetId(area.sheetId) : null
    if (!area || !workbook || !sheet) return
    try {
      workbook.setActiveSheet(sheet)
      sheet.getRange(area.startRow, area.startColumn, 1, 1).activate()
    } catch {
      // the sheet or cell went away meanwhile
    }
  }

  const beforeSend = (attachments: readonly AttachmentMeta[]): Promise<SensitiveSendAnswer> => {
    let documentCandidates: SheetCandidate[] = []
    let attachmentCount = 0
    return alert
      .beforeSend(async () => {
        documentCandidates = await findCandidates()
        attachmentCount = await countAttachmentCandidates(attachments)
        return { documentCount: documentCandidates.length, attachmentCount }
      })
      .then((answer) => {
        if (answer === 'review') openList(attachmentCount, documentCandidates)
        return answer
      })
  }

  const command = (command: string): boolean => {
    const { univerRef, setMessage, readColumn } = argsRef.current
    if (command === SENSITIVE_HIDE_COMMAND) {
      const selection = selectedAreas(univerRef.current)
      void hideTargetOf(selection, readColumn).then((target) => {
        if (target && target.areas.length > 0) setPending(target)
      })
      return true
    }
    if (command === SENSITIVE_UNHIDE_COMMAND) {
      const runtime = univerRef.current
      if (!runtime) return true
      const selection = selectedAreas(runtime).map((entry) => entry.area)
      const changed = removeHiding(runtime, selection)
      setMessage(
        changed > 0
          ? t('appSensitiveUnhidden', { range: selection.map(areaText).join(', ') })
          : t('appSensitiveNothingHidden'),
      )
      return true
    }
    return false
  }

  const element = pending ? (
    <SensitiveLabelDialog
      lang={args.lang}
      seed={pending.seed}
      onCancel={() => setPending(null)}
      onSubmit={(label) => {
        const target = pending
        setPending(null)
        hide(target.areas, label)
      }}
    />
  ) : null

  const panel = (
    <div className="sheet-sensitive">
      {alert.alert}
      {list ? (
        <SensitiveCandidateList
          lang={args.lang}
          busy={list.busy}
          candidates={list.candidates.map((candidate) => candidate.row)}
          attachmentCount={list.attachmentCount}
          onConfirm={confirm}
          onExclude={exclude}
          onLocate={locate}
          onClose={() => setList(null)}
        />
      ) : (
        <SensitiveFindButton lang={args.lang} onClick={() => openList()} />
      )}
    </div>
  )

  return { command, element, panel, hide, beforeSend }
}
