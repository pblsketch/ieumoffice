import { useEffect, useRef, useState } from 'react'
import type { Params } from '@genoffice/i18n'
import type { PdfOrganizePageSpec, PdfToolInput } from '../../../shared/pdf-tools-api'
import type { PdfToolsStringKey } from '../i18n/strings-pdf-tools'

export interface OrganizeCard extends PdfOrganizePageSpec {
  uid: string
}

interface OrganizeViewProps {
  t: (key: PdfToolsStringKey, params?: Params) => string
  primaryInput: PdfToolInput
  busy: boolean
  onSave(plan: PdfOrganizePageSpec[]): void
  onPickInsertPdf(): Promise<PdfToolInput | null>
  onTrackExtraInput?(id: string): void
}

const THUMB_CHUNK_SIZE = 24
const DEFAULT_A4_W = 595
const DEFAULT_A4_H = 842

let nextUid = 1
const makeUid = () => `org-${nextUid++}`

function buildInitialCards(input: PdfToolInput): OrganizeCard[] {
  return Array.from({ length: Math.max(0, input.pages) }, (_, i) => ({
    uid: makeUid(),
    sourceId: input.id,
    sourcePageIndex: i,
    extraRotation: 0,
  }))
}

/**
 * Visual Organize Pages grid: progressive 24-page thumbnail loading, drag-and-drop
 * reordering, multi-select (click / Ctrl / Shift / Odd / Even / All), rotate left/right,
 * duplicate, delete (keeping >= 1 page), insert blank page, insert another PDF,
 * undo/redo, and save all or extract selected pages.
 */
export function OrganizeView({
  t,
  primaryInput,
  busy,
  onSave,
  onPickInsertPdf,
  onTrackExtraInput,
}: OrganizeViewProps) {
  const api = window.aiOfficePdfTools
  const [cards, setCards] = useState<OrganizeCard[]>(() => buildInitialCards(primaryInput))
  const [history, setHistory] = useState<OrganizeCard[][]>([])
  const [future, setFuture] = useState<OrganizeCard[][]>([])
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [anchorIdx, setAnchorIdx] = useState<number | null>(null)
  const [thumbs, setThumbs] = useState<
    Record<string, { thumb: string; widthPt: number; heightPt: number }>
  >({})
  const [loadingThumbs, setLoadingThumbs] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [pendingLocked, setPendingLocked] = useState<PdfToolInput[]>([])
  const [lockDrafts, setLockDrafts] = useState<Record<string, string>>({})
  const [lockErrors, setLockErrors] = useState<Record<string, string>>({})
  const loadedSourcesRef = useRef<Set<string>>(new Set())

  const loadSourceThumbs = async (input: PdfToolInput, cancelled: () => boolean) => {
    if (input.pages <= 0 || loadedSourcesRef.current.has(input.id)) return
    loadedSourcesRef.current.add(input.id)
    setLoadingThumbs(true)
    try {
      for (let start = 1; start <= input.pages; start += THUMB_CHUNK_SIZE) {
        if (cancelled()) break
        const end = Math.min(input.pages, start + THUMB_CHUNK_SIZE - 1)
        const res = await api.renderThumbs(input.id, start, end)
        if (cancelled() || !res.ok) break
        setThumbs((prev) => {
          const next = { ...prev }
          for (const item of res.thumbs) {
            next[`${input.id}:${item.page - 1}`] = {
              thumb: item.thumb,
              widthPt: item.widthPt,
              heightPt: item.heightPt,
            }
          }
          return next
        })
      }
    } finally {
      if (!cancelled()) setLoadingThumbs(false)
    }
  }

  useEffect(() => {
    let stop = false
    loadedSourcesRef.current.clear()
    setCards(buildInitialCards(primaryInput))
    setHistory([])
    setFuture([])
    setSelected(new Set())
    setAnchorIdx(null)
    setThumbs({})
    if (!primaryInput.encrypted || primaryInput.unlocked) {
      void loadSourceThumbs(primaryInput, () => stop)
    }
    return () => {
      stop = true
      void api.cancelThumbs()
    }
  }, [api, primaryInput.id, primaryInput.pages, primaryInput.unlocked])

  const commit = (updater: (prev: OrganizeCard[]) => OrganizeCard[]) => {
    setCards((prev) => {
      const next = updater(prev)
      if (next === prev) return prev
      setHistory((h) => [...h.slice(-29), prev])
      setFuture([])
      return next
    })
  }

  const undo = () => {
    if (history.length === 0) return
    const prev = history[history.length - 1]!
    setHistory((h) => h.slice(0, -1))
    setFuture((f) => [cards, ...f])
    setCards(prev)
  }

  const redo = () => {
    if (future.length === 0) return
    const next = future[0]!
    setFuture((f) => f.slice(1))
    setHistory((h) => [...h, cards])
    setCards(next)
  }

  const toggleSelect = (idx: number, uid: string, e: React.MouseEvent) => {
    if (e.shiftKey && anchorIdx !== null) {
      const lo = Math.min(anchorIdx, idx)
      const hi = Math.max(anchorIdx, idx)
      const next = new Set(selected)
      for (let i = lo; i <= hi; i++) {
        const c = cards[i]
        if (c) next.add(c.uid)
      }
      setSelected(next)
      return
    }
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      setSelected(next)
      setAnchorIdx(idx)
      return
    }
    setSelected((prev) => (prev.size === 1 && prev.has(uid) ? new Set() : new Set([uid])))
    setAnchorIdx(idx)
  }

  const rotateSelected = (delta: 90 | 270) => {
    if (selected.size === 0) return
    commit((prev) =>
      prev.map((c) =>
        selected.has(c.uid)
          ? { ...c, extraRotation: ((c.extraRotation + delta) % 360) as 0 | 90 | 180 | 270 }
          : c,
      ),
    )
  }

  const duplicateSelected = () => {
    if (selected.size === 0) return
    commit((prev) => {
      const out: OrganizeCard[] = []
      for (const c of prev) {
        out.push(c)
        if (selected.has(c.uid)) out.push({ ...c, uid: makeUid() })
      }
      return out
    })
  }

  const deleteSelected = () => {
    if (selected.size === 0 || selected.size >= cards.length) return
    commit((prev) => prev.filter((c) => !selected.has(c.uid)))
    setSelected(new Set())
  }

  const insertBlank = () => {
    const lastSelectedIdx = cards.reduce(
      (acc, c, i) => (selected.has(c.uid) ? i : acc),
      cards.length - 1,
    )
    const refCard = cards[Math.max(0, lastSelectedIdx)]
    const refThumb = refCard ? thumbs[`${refCard.sourceId}:${refCard.sourcePageIndex}`] : undefined
    const blankCard: OrganizeCard = {
      uid: makeUid(),
      sourceId: 'blank',
      sourcePageIndex: 0,
      extraRotation: 0,
      widthPt: refThumb?.widthPt ?? refCard?.widthPt ?? DEFAULT_A4_W,
      heightPt: refThumb?.heightPt ?? refCard?.heightPt ?? DEFAULT_A4_H,
    }
    commit((prev) => {
      const next = [...prev]
      next.splice(lastSelectedIdx + 1, 0, blankCard)
      return next
    })
  }

  const handleInsertPdf = async () => {
    const added = await onPickInsertPdf()
    if (!added) return
    onTrackExtraInput?.(added.id)
    if (added.encrypted && !added.unlocked) {
      setPendingLocked((prev) => [...prev, added])
      return
    }
    if (added.pages <= 0) return
    const extraCards = buildInitialCards(added)
    commit((prev) => [...prev, ...extraCards])
    void loadSourceThumbs(added, () => false)
  }

  const unlockInserted = async (item: PdfToolInput) => {
    const pw = lockDrafts[item.id] ?? ''
    if (!pw) return
    const res = await api.unlockInput(item.id, pw)
    if (!res.ok) {
      setLockErrors((prev) => ({ ...prev, [item.id]: t('errWrongPassword') }))
      return
    }
    const unlocked: PdfToolInput = { ...item, unlocked: true, pages: res.pages }
    setPendingLocked((prev) => prev.filter((x) => x.id !== item.id))
    setLockDrafts((prev) => {
      const next = { ...prev }
      delete next[item.id]
      return next
    })
    setLockErrors((prev) => {
      const next = { ...prev }
      delete next[item.id]
      return next
    })
    if (unlocked.pages > 0) {
      const extraCards = buildInitialCards(unlocked)
      commit((prev) => [...prev, ...extraCards])
      void loadSourceThumbs(unlocked, () => false)
    }
  }

  const dismissLocked = (id: string) => {
    setPendingLocked((prev) => prev.filter((x) => x.id !== id))
    setLockDrafts((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setLockErrors((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    void api.releaseInputs([id])
  }

  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= cards.length || to >= cards.length) return
    commit((prev) => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved!)
      return next
    })
  }

  const toSpecs = (list: OrganizeCard[]): PdfOrganizePageSpec[] =>
    list.map(({ uid: _uid, ...spec }) => spec)

  const selectedCount = selected.size
  const canDelete = selectedCount > 0 && selectedCount < cards.length

  return (
    <div className="pt-organize">
      <p className="pt-hint">{t('organizeHint')}</p>
      <div className="pt-org-toolbar">
        <button
          type="button"
          className="pt-btn pt-btn-sm"
          disabled={busy}
          onClick={() => void handleInsertPdf()}
        >
          {t('organizeInsertPdf')}
        </button>
        <button type="button" className="pt-btn pt-btn-sm" disabled={busy} onClick={insertBlank}>
          {t('organizeAddBlank')}
        </button>
        <span className="pt-org-sep" />
        <button
          type="button"
          className="pt-btn pt-btn-sm"
          disabled={busy || cards.length === 0}
          onClick={() => setSelected(new Set(cards.map((c) => c.uid)))}
        >
          {t('selectAll')}
        </button>
        <button
          type="button"
          className="pt-btn pt-btn-sm"
          disabled={busy || selectedCount === 0}
          onClick={() => setSelected(new Set())}
        >
          {t('selectNone')}
        </button>
        <button
          type="button"
          className="pt-btn pt-btn-sm"
          disabled={busy || cards.length === 0}
          onClick={() =>
            setSelected(new Set(cards.filter((_, i) => i % 2 === 0).map((c) => c.uid)))
          }
        >
          {t('organizeSelectOdd')}
        </button>
        <button
          type="button"
          className="pt-btn pt-btn-sm"
          disabled={busy || cards.length === 0}
          onClick={() =>
            setSelected(new Set(cards.filter((_, i) => i % 2 === 1).map((c) => c.uid)))
          }
        >
          {t('organizeSelectEven')}
        </button>
        <span className="pt-org-sep" />
        <button
          type="button"
          className="pt-btn pt-btn-sm"
          disabled={busy || selectedCount === 0}
          onClick={() => rotateSelected(270)}
        >
          {t('organizeRotateLeft')}
        </button>
        <button
          type="button"
          className="pt-btn pt-btn-sm"
          disabled={busy || selectedCount === 0}
          onClick={() => rotateSelected(90)}
        >
          {t('organizeRotateRight')}
        </button>
        <button
          type="button"
          className="pt-btn pt-btn-sm"
          disabled={busy || selectedCount === 0}
          onClick={duplicateSelected}
        >
          {t('organizeDuplicate')}
        </button>
        <button
          type="button"
          className="pt-btn pt-btn-sm"
          disabled={busy || !canDelete}
          onClick={deleteSelected}
        >
          {t('organizeDelete')}
        </button>
        <span className="pt-org-sep" />
        <button
          type="button"
          className="pt-btn pt-btn-sm"
          disabled={busy || history.length === 0}
          onClick={undo}
        >
          {t('organizeUndo')}
        </button>
        <button
          type="button"
          className="pt-btn pt-btn-sm"
          disabled={busy || future.length === 0}
          onClick={redo}
        >
          {t('organizeRedo')}
        </button>
      </div>

      {loadingThumbs && <p className="pt-hint">{t('organizeLoadingThumbs')}</p>}

      {pendingLocked.length > 0 && (
        <ul className="pt-list">
          {pendingLocked.map((item) => (
            <li key={item.id} className="pt-item pt-item-col">
              <div className="pt-item-row">
                <span className="pt-item-name" title={item.name}>
                  {item.name}
                </span>
                <span className="pt-badge pt-badge-warn">{t('lockedBadge')}</span>
                <button
                  type="button"
                  className="pt-btn pt-btn-sm"
                  disabled={busy}
                  onClick={() => dismissLocked(item.id)}
                >
                  {t('remove')}
                </button>
              </div>
              <div className="pt-unlock-row">
                <input
                  type="password"
                  className="pt-input pt-unlock-input"
                  value={lockDrafts[item.id] ?? ''}
                  placeholder={t('unlockPlaceholder')}
                  disabled={busy}
                  onChange={(e) =>
                    setLockDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void unlockInserted(item)
                  }}
                />
                <button
                  type="button"
                  className="pt-btn pt-btn-sm"
                  disabled={busy || !(lockDrafts[item.id] ?? '')}
                  onClick={() => void unlockInserted(item)}
                >
                  {t('unlockButton')}
                </button>
                {lockErrors[item.id] && (
                  <span className="pt-unlock-err" role="alert">
                    {lockErrors[item.id]}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="pt-org-grid">
        {cards.map((card, idx) => {
          const isSel = selected.has(card.uid)
          const thumbData =
            card.sourceId === 'blank' ? null : thumbs[`${card.sourceId}:${card.sourcePageIndex}`]
          return (
            <div
              key={card.uid}
              className={`pt-org-card${isSel ? ' is-selected' : ''}${dropIndex === idx ? ' is-drop-target' : ''}`}
              draggable={!busy}
              onDragStart={() => setDragIndex(idx)}
              onDragOver={(e) => {
                e.preventDefault()
                if (dropIndex !== idx) setDropIndex(idx)
              }}
              onDragLeave={() => {
                if (dropIndex === idx) setDropIndex(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragIndex !== null) reorder(dragIndex, idx)
                setDragIndex(null)
                setDropIndex(null)
              }}
              onDragEnd={() => {
                setDragIndex(null)
                setDropIndex(null)
              }}
              onClick={(e) => toggleSelect(idx, card.uid, e)}
            >
              <div className="pt-org-thumb-box">
                {card.sourceId === 'blank' ? (
                  <span className="pt-org-blank">{t('organizeBlankLabel')}</span>
                ) : thumbData ? (
                  <img
                    src={thumbData.thumb}
                    alt=""
                    className="pt-org-thumb"
                    style={
                      card.extraRotation
                        ? { transform: `rotate(${card.extraRotation}deg)` }
                        : undefined
                    }
                  />
                ) : (
                  <span className="pt-org-placeholder">{idx + 1}</span>
                )}
              </div>
              <div className="pt-org-card-foot">
                <span className="pt-org-page-num">{idx + 1}</span>
                {card.extraRotation > 0 && <span className="pt-badge">{card.extraRotation}°</span>}
              </div>
            </div>
          )
        })}
      </div>

      <div className="pt-actions">
        {selectedCount > 0 && (
          <button
            type="button"
            className="pt-btn"
            disabled={busy}
            onClick={() => onSave(toSpecs(cards.filter((c) => selected.has(c.uid))))}
          >
            {t('organizeSaveSelected')} ({selectedCount})
          </button>
        )}
        <button
          type="button"
          className="pt-btn pt-btn-primary"
          disabled={busy || cards.length === 0}
          onClick={() => onSave(toSpecs(cards))}
        >
          {busy ? t('running') : t('run')}
        </button>
      </div>
    </div>
  )
}
