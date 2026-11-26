/**
 * The full-screen PDF tools layer (spec 5.1, 5.3, 5.4): tools list → files →
 * options sheet → running → result sheet, and for blank pages files → find →
 * review → running → result. Every step answers Back once (useBackLayer).
 *
 * Work runs in the engine's worker (tools/engine); results stay in memory
 * until they are opened, shared or saved, and nothing here writes a file of
 * its own. No AI, no permission prompt: files come from the system picker.
 *
 * Keeping the screen on while a tool runs is T6's `useKeepScreenOn(client,
 * running)`; it is wired when T6 is merged (docs/plans/mobile-v1/T3.md).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { checkOptions, toolInputKind, toolMinInputs, toolTakesMany } from '@genoffice/pdf-ops'
import {
  bytesToBase64,
  savePdfToolResultCopy,
  sharePdfToolResult,
} from '@genoffice/mobile-bridge/pdf-tools'
import { isMobileCommandError, type MobileDocFormat } from '@genoffice/mobile-bridge/transport'
import { IconBack } from '../../components/MobileIcons'
import type { HomeHost } from '../../home/homeHost'
import { useMobileLocale, type MobileStringKey } from '../../i18n'
import { useBackLayer } from '../../shell/backStack'
import { BlankReview, initialBlankChoice } from '../blank'
import { toolNameKey, type MobilePdfToolId } from '../catalog'
import { createPdfToolsEngine, PdfToolsEngineError } from '../engine/client'
import type {
  BlankCandidateView,
  PdfToolOptions,
  PdfToolsEngine,
  ToolFile,
  ToolResultFile,
  ToolRunOutcome,
} from '../engine/types'
import { useEditorOpens, usePdfToolsEnv } from '../env'
import type { PdfToolsFlowProps } from '../link'
import { initialToolOptions, ToolOptionsForm, type ToolOptionsError } from '../options'
import { ToolsList } from '../ToolsList'
import { ConfirmDialog } from './ConfirmDialog'
import { FilesStep, type FileEntry } from './FilesStep'
import { failureKey, optionsErrorKey, toolFileOf } from './format'
import { OptionsSheet } from './OptionsSheet'
import { ResultSheet } from './ResultSheet'
import { RunningStep } from './RunningStep'

/** HomeHost with T6's optional untitled-copy opener (not in the base HomeHost yet) */
type HostWithCopy = HomeHost & {
  openUntitledCopy?(params: {
    format: MobileDocFormat
    name: string
    bytesBase64: string
  }): Promise<void>
}

type Phase = 'files' | 'options' | 'running' | 'review' | 'result'

interface Results {
  readonly files: readonly ToolResultFile[]
  readonly sizeBefore?: number
  readonly oversizedPages?: readonly number[]
}

interface BlankFound {
  readonly candidates: readonly BlankCandidateView[]
  readonly pageCount: number
}

type Confirm =
  | { readonly kind: 'stop' }
  | { readonly kind: 'discard-close' }
  | { readonly kind: 'discard-open'; readonly index: number }

type Validated = { ok: true; options: PdfToolOptions } | { ok: false; error: ToolOptionsError }

/** The raw options checked the way the engine checks them, plus the screen-only password check */
function validate(
  tool: MobilePdfToolId,
  raw: Record<string, unknown>,
  pageCount: number,
): Validated {
  const checked = checkOptions(tool, raw, pageCount)
  if (!checked.ok) return checked
  if (
    tool === 'encrypt' &&
    typeof raw.passwordConfirm === 'string' &&
    raw.passwordConfirm !== raw.password
  ) {
    return { ok: false, error: 'password-mismatch' }
  }
  return checked
}

const PASSWORD_FIELDS = ['password', 'passwordConfirm', 'permissionPassword'] as const

/** `raw` without any typed password (after every run) */
function withoutPasswords(raw: Record<string, unknown>): Record<string, unknown> {
  if (!PASSWORD_FIELDS.some((field) => field in raw)) return raw
  const next = { ...raw }
  for (const field of PASSWORD_FIELDS) delete next[field]
  return next
}

const extOf = (file: ToolResultFile): 'pdf' | 'txt' => (file.mime === 'text/plain' ? 'txt' : 'pdf')

const isCancelled = (err: unknown) => isMobileCommandError(err) && err.code === 'USER_CANCELLED'

/**
 * A handler that keeps its identity across renders: Sheet moves focus again
 * whenever its onClose changes, which would pull focus out of a form field.
 */
function useStableHandler<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  const ref = useRef(fn)
  ref.current = fn
  return useCallback((...args: A) => ref.current(...args), [])
}

export default function PdfToolsFlowScreen({ host, start, onClose }: PdfToolsFlowProps) {
  const { t } = useMobileLocale()
  const env = usePdfToolsEnv()
  const editorOpens = useEditorOpens()
  const copyHost = host as HostWithCopy

  /** the tools list is the first step only when the screen was opened on it */
  const rootIsList = start.kind === 'menu'
  const firstTool: MobilePdfToolId | null =
    start.kind === 'menu' ? null : start.kind === 'tool' ? start.tool : start.kind

  const nextId = useRef(1)
  const makeEntry = (file: ToolFile, sizeBytes: number | null): FileEntry => ({
    id: nextId.current++,
    file,
    sizeBytes,
    check: 'pending',
  })

  const [tool, setTool] = useState<MobilePdfToolId | null>(firstTool)
  const [entries, setEntries] = useState<readonly FileEntry[]>(() =>
    start.kind === 'merge' || start.kind === 'imagesToPdf'
      ? start.inputs.map((input) => makeEntry(input, input.sizeBytes ?? null))
      : [],
  )
  const [phase, setPhase] = useState<Phase>('files')
  const [raw, setRaw] = useState<Record<string, unknown>>(() =>
    firstTool ? initialToolOptions(firstTool) : {},
  )
  const [attempted, setAttempted] = useState(false)
  const [notice, setNotice] = useState<MobileStringKey | null>(null)
  const [finding, setFinding] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [blank, setBlank] = useState<BlankFound | null>(null)
  const [chosen, setChosen] = useState<ReadonlySet<number>>(new Set())
  const [results, setResults] = useState<Results | null>(null)
  const [handled, setHandled] = useState<ReadonlySet<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const zipRef = useRef<ToolResultFile | null>(null)

  // one engine per screen, made on first use and let go when the screen closes
  const engineRef = useRef<PdfToolsEngine | null>(null)
  const mountedRef = useRef(true)
  const getEngine = useCallback((): PdfToolsEngine => {
    engineRef.current ??= (env.createEngine ?? createPdfToolsEngine)()
    return engineRef.current
  }, [env.createEngine])
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      engineRef.current?.dispose()
      engineRef.current = null
    }
  }, [])

  const titleRef = useRef<HTMLHeadingElement | null>(null)
  useEffect(() => {
    titleRef.current?.focus()
  }, [tool])

  // inspect the picked files one at a time
  const checkingRef = useRef<number | null>(null)
  useEffect(() => {
    if (!tool || checkingRef.current !== null) return
    const next = entries.find((entry) => entry.check === 'pending')
    if (!next) return
    checkingRef.current = next.id
    void getEngine()
      .inspect(next.file, tool)
      .then(
        (found) => found,
        () => null,
      )
      .then((found) => {
        checkingRef.current = null
        if (!mountedRef.current) return
        setEntries((list) =>
          list.map((entry) =>
            entry.id !== next.id
              ? entry
              : {
                  ...entry,
                  sizeBytes: entry.sizeBytes ?? found?.sizeBytes ?? null,
                  check: found
                    ? found.ok
                      ? { ok: true, pages: found.pages }
                      : { ok: false, problem: found.problem }
                    : { ok: false, problem: 'unreadable' },
                },
          ),
        )
      })
  }, [entries, tool, getEngine])

  const usable = useMemo(
    () => entries.filter((entry) => entry.check !== 'pending' && entry.check.ok),
    [entries],
  )
  const pageCount = (() => {
    const first = usable[0]?.check
    return first && first !== 'pending' && first.ok ? first.pages : 1
  })()
  const takesMany = tool ? toolTakesMany(tool) : false
  const canNext =
    tool !== null &&
    entries.every((entry) => entry.check !== 'pending') &&
    usable.length >= toolMinInputs(tool)

  const validated = tool ? validate(tool, raw, pageCount) : null
  const optionsError = attempted && validated && !validated.ok ? validated.error : null

  const resetTool = (next: MobilePdfToolId | null) => {
    setTool(next)
    setEntries([])
    setRaw(next ? initialToolOptions(next) : {})
    setAttempted(false)
    setNotice(null)
    setPhase('files')
    setBlank(null)
    setChosen(new Set())
    setResults(null)
    setHandled(new Set())
    zipRef.current = null
  }

  /** Back from the files step: to the list when the screen opened on it, else out */
  const backFromBase = () => {
    if (tool !== null && rootIsList) resetTool(null)
    else onClose()
  }
  const backFromReview = () => {
    setBlank(null)
    setNotice(null)
    setPhase('files')
  }
  const askStop = () => setConfirm({ kind: 'stop' })

  useBackLayer(true, backFromBase)
  useBackLayer(phase === 'running', askStop)
  useBackLayer(phase === 'review', backFromReview)

  const onAppBarBack = () => {
    if (phase === 'running') askStop()
    else if (phase === 'review') backFromReview()
    else backFromBase()
  }

  const addFiles = (picked: File[]) => {
    const made = picked.map((file) => makeEntry(toolFileOf(file), file.size))
    setEntries((list) => (takesMany ? [...list, ...made] : made.slice(0, 1)))
  }
  const moveFile = (id: number, by: -1 | 1) => {
    setEntries((list) => {
      const from = list.findIndex((entry) => entry.id === id)
      const to = from + by
      if (from < 0 || to < 0 || to >= list.length) return list
      const next = [...list]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved!)
      return next
    })
  }
  const removeFile = (id: number) => setEntries((list) => list.filter((entry) => entry.id !== id))

  /** How a run or a search ended without a result */
  const endedWithout = (reason: Exclude<ToolRunOutcome, { ok: true }>['reason'], backTo: Phase) => {
    setPhase(backTo)
    if (reason === 'stopped') {
      setNotice(null)
      host.showToast(t('pdfToolsStopped'))
    } else {
      setNotice(failureKey(tool!, reason))
    }
  }

  const runTool = async (options: PdfToolOptions, backTo: Phase) => {
    if (!tool) return
    setConfirm(null)
    setNotice(null)
    setFinding(false)
    setProgress(null)
    setPhase('running')
    const outcome = await getEngine().run(
      tool,
      usable.map((entry) => entry.file),
      options,
      (done, total) => {
        if (mountedRef.current) setProgress({ done, total })
      },
    )
    if (!mountedRef.current) return
    setRaw(withoutPasswords)
    setAttempted(false)
    setConfirm(null)
    if (!outcome.ok) {
      endedWithout(outcome.reason, backTo)
      return
    }
    zipRef.current = null
    setHandled(new Set())
    setResults({
      files: outcome.files,
      ...(outcome.sizeBefore !== undefined ? { sizeBefore: outcome.sizeBefore } : {}),
      ...(outcome.oversizedPages ? { oversizedPages: outcome.oversizedPages } : {}),
    })
    setPhase('result')
  }

  const findBlank = async () => {
    const file = usable[0]?.file
    if (!file) return
    setNotice(null)
    setFinding(true)
    setProgress(null)
    setPhase('running')
    const found = await getEngine().findBlankPages(file, (done, total) => {
      if (mountedRef.current) setProgress({ done, total })
    })
    if (!mountedRef.current) return
    setConfirm(null)
    if (!found.ok) {
      endedWithout(found.reason, 'options')
      return
    }
    setBlank({ candidates: found.candidates, pageCount: found.pageCount })
    setChosen(initialBlankChoice(found.candidates))
    setPhase('review')
  }

  const startOptions = () => {
    if (!tool || !validated) return
    if (tool === 'blankPages') {
      void findBlank()
      return
    }
    if (!validated.ok) {
      setAttempted(true)
      return
    }
    void runTool(validated.options, 'options')
  }

  const removeChosen = () => {
    if (!blank) return
    const pages = [...chosen].sort((a, b) => a - b)
    const checked = checkOptions('blankPages', { removePages: pages.join(',') }, blank.pageCount)
    if (!checked.ok) {
      setNotice(optionsErrorKey(checked.error))
      return
    }
    void runTool(checked.options, 'review')
  }

  const stopNow = () => {
    setConfirm(null)
    getEngine().stop()
  }

  // ---- results

  const unhandledOther = (except: number | null) =>
    results ? results.files.some((_, index) => index !== except && !handled.has(index)) : false

  const markHandled = (indices: readonly number[]) =>
    setHandled((done) => new Set([...done, ...indices]))

  const canOpen = (file: ToolResultFile) =>
    typeof copyHost.openUntitledCopy === 'function' && editorOpens(extOf(file))

  const finishResult = () => {
    setConfirm(null)
    if (rootIsList) resetTool(null)
    else onClose()
  }

  const closeResult = useStableHandler(() => {
    if (unhandledOther(null)) setConfirm({ kind: 'discard-close' })
    else finishResult()
  })
  const closeOptions = useStableHandler(() => {
    setNotice(null)
    setPhase('files')
  })

  const openResult = async (index: number) => {
    setConfirm(null)
    const file = results?.files[index]
    const open = copyHost.openUntitledCopy
    if (!file || !open) return
    try {
      await open.call(copyHost, {
        format: extOf(file),
        name: file.name,
        bytesBase64: bytesToBase64(file.bytes),
      })
      if (mountedRef.current) onClose()
    } catch (err) {
      if (isCancelled(err)) return
      host.showToast({ message: t('pdfToolsErrFailed'), tone: 'error' })
    }
  }

  const askOpen = (index: number) => {
    if (unhandledOther(index)) setConfirm({ kind: 'discard-open', index })
    else void openResult(index)
  }

  const share = async (file: ToolResultFile, indices: readonly number[]) => {
    setBusy(true)
    try {
      const shared = await sharePdfToolResult(host.client, file)
      if (shared.ok !== false) markHandled(indices)
    } catch (err) {
      if (!isCancelled(err)) host.showToast({ message: t('pdfToolsShareFailed'), tone: 'error' })
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  const save = async (file: ToolResultFile, indices: readonly number[]) => {
    setBusy(true)
    try {
      await savePdfToolResultCopy(host.client, file)
      markHandled(indices)
      host.showToast(t('pdfToolsSaved'))
    } catch (err) {
      if (!isCancelled(err)) host.showToast({ message: t('pdfToolsSaveFailed'), tone: 'error' })
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  /** The split parts as one ZIP named after the source, made once */
  const zipAll = async (): Promise<ToolResultFile | null> => {
    if (!results) return null
    if (zipRef.current) return zipRef.current
    const source = usable[0]?.file.name ?? 'document.pdf'
    const base = source.replace(/\.pdf$/i, '') || 'document'
    setBusy(true)
    try {
      const made = await getEngine().zip(results.files, `${base}-split.zip`)
      zipRef.current = made
      return made
    } catch (err) {
      const tooLarge = err instanceof PdfToolsEngineError && err.reason === 'too-large'
      host.showToast({
        message: t(tooLarge ? 'pdfToolsTooLargeForDevice' : 'pdfToolsErrFailed'),
        tone: 'error',
      })
      return null
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  const allIndices = () => (results ? results.files.map((_, index) => index) : [])

  const zipShare = async () => {
    const zip = await zipAll()
    if (zip) await share(zip, allIndices())
  }
  const zipSave = async () => {
    const zip = await zipAll()
    if (zip) await save(zip, allIndices())
  }

  // ---- drawing

  const title = tool ? t(toolNameKey(tool)) : t('pdfToolsWindowTitle')

  let body
  if (tool === null) {
    body = <ToolsList host={host} onPickTool={resetTool} onLeave={onClose} />
  } else if (phase === 'running') {
    body = <RunningStep finding={finding} progress={progress} onStop={stopNow} />
  } else if (phase === 'review' && blank) {
    const allChosen = chosen.size >= blank.pageCount
    body = (
      <div className="pdf-tools-review" data-testid="pdf-tools-review">
        {blank.candidates.length === 0 ? (
          <p className="pdf-tools-notice" role="status">
            {t('pdfToolsBlankNone')}
          </p>
        ) : (
          <>
            <p className="mobile-muted">
              {t('pdfToolsBlankFound', { n: blank.candidates.length })}
            </p>
            <BlankReview
              candidates={blank.candidates}
              pageCount={blank.pageCount}
              chosen={chosen}
              onChange={(next) => {
                // only pages the search found can be removed
                const found = new Set(blank.candidates.map((c) => c.page))
                setChosen(new Set([...next].filter((page) => found.has(page))))
                setNotice(null)
              }}
            />
          </>
        )}
        {notice && (
          <p className="pdf-tools-notice" role="alert">
            {t(notice)}
          </p>
        )}
        <div className="pdf-tools-step-actions">
          <button
            type="button"
            className="mobile-touch-btn mobile-btn-primary"
            disabled={chosen.size === 0 || allChosen}
            onClick={removeChosen}
          >
            {t('pdfToolsRemoveChosenPages')}
          </button>
        </div>
      </div>
    )
  } else {
    body = (
      <FilesStep
        tool={tool}
        entries={entries}
        takesMany={takesMany}
        inputKind={toolInputKind(tool)}
        canNext={canNext}
        onAdd={addFiles}
        onMove={moveFile}
        onRemove={removeFile}
        onNext={() => {
          setNotice(null)
          setAttempted(false)
          setPhase('options')
        }}
      />
    )
  }

  return (
    <div className="pdf-tools-flow" data-testid="pdf-tools-flow">
      <header className="mobile-appbar">
        <button
          type="button"
          className="mobile-icon-btn"
          onClick={onAppBarBack}
          aria-label={t('back')}
          title={t('back')}
        >
          <IconBack size={22} />
        </button>
        <h1 ref={titleRef} className="mobile-appbar-title" tabIndex={-1}>
          {title}
        </h1>
        <span className="mobile-header-spacer" aria-hidden="true" />
      </header>
      <main className="pdf-tools-flow-body">{body}</main>

      {tool !== null && phase === 'options' && (
        <OptionsSheet
          title={title}
          tool={tool}
          finding={tool === 'blankPages'}
          notice={notice}
          error={optionsError}
          onStart={startOptions}
          onClose={closeOptions}
        >
          {tool !== 'blankPages' && (
            <ToolOptionsForm
              tool={tool}
              pageCount={pageCount}
              input={usable[0]?.file ?? null}
              raw={raw}
              onChange={(next) => {
                setRaw(next)
                setNotice(null)
              }}
              error={optionsError}
            />
          )}
        </OptionsSheet>
      )}

      {phase === 'result' && results && (
        <ResultSheet
          files={results.files}
          {...(results.sizeBefore !== undefined ? { sizeBefore: results.sizeBefore } : {})}
          {...(results.oversizedPages ? { oversizedPages: results.oversizedPages } : {})}
          busy={busy}
          canOpen={canOpen}
          onOpen={askOpen}
          onShare={(index) => void share(results.files[index]!, [index])}
          onSave={(index) => void save(results.files[index]!, [index])}
          onZipShare={() => void zipShare()}
          onZipSave={() => void zipSave()}
          onClose={closeResult}
        />
      )}

      {confirm?.kind === 'stop' && (
        <ConfirmDialog
          testId="pdf-tools-stop-confirm"
          message={t('pdfToolsStopConfirm')}
          cancelLabel={t('pdfToolsContinue')}
          actionLabel={t('pdfToolsStop')}
          danger
          onCancel={() => setConfirm(null)}
          onAction={stopNow}
        />
      )}
      {(confirm?.kind === 'discard-close' || confirm?.kind === 'discard-open') && (
        <ConfirmDialog
          testId="pdf-tools-discard-confirm"
          message={t('pdfToolsDiscardConfirm')}
          cancelLabel={t('pdfToolsCancel')}
          actionLabel={t('pdfToolsClose')}
          danger
          onCancel={() => setConfirm(null)}
          onAction={() => {
            if (confirm.kind === 'discard-open') void openResult(confirm.index)
            else finishResult()
          }}
        />
      )}
    </div>
  )
}
