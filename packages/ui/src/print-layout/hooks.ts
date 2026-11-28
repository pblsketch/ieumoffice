import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createDefaultImageExportOptions,
  createDefaultOptions,
  type ImageExportOptions,
  type PrintLayoutOptions,
} from '@genoffice/print-layout/plan'
import {
  coupleDuplex,
  createDuplexCoupling,
  effectiveCollate,
  isCollateLocked,
  setDuplexByUser,
  type DuplexCoupling,
  type PrintLayoutDuplex,
  type PrintLayoutProgress,
} from './model'

/** Printer option values that are not device names (Electron: '' = OS default). */
export const DEFAULT_PRINTER = ''
export const SYSTEM_DIALOG = '\u0000system-dialog'
export const SAVE_PDF_DEST = '\u0000save-pdf'
export const SAVE_IMAGES_DEST = '\u0000save-images'

export type PrintDestinationKind = 'printer' | 'system' | 'save-pdf' | 'save-images'

export interface PrintPrinterInfo {
  readonly name: string
  readonly displayName: string
  readonly isDefault?: boolean | undefined
}

/** Per-job printer options passed to `print-layout-print` (matches `PrintJobOptions`). */
export interface PrintJobSelection {
  readonly deviceName: string | null
  readonly copies?: number | undefined
  readonly collate?: boolean | undefined
  readonly duplex?: PrintLayoutDuplex | undefined
}

export interface UsePrintJobConfig {
  /** true for permission-restricted PDFs: disables Save as PDF & Save as images */
  readonly saveRestricted?: boolean | undefined
  /** hide Save as PDF / Save as images from the dropdown if an editor does not wire them */
  readonly allowSaveDestinations?: boolean | undefined
  /** optional initial destination (e.g. SAVE_PDF_DEST or SAVE_IMAGES_DEST from Quick Print menu) */
  readonly initialDestination?: string | undefined
}

export interface PrintJobState {
  readonly printers: readonly PrintPrinterInfo[]
  readonly deviceName: string
  readonly setDeviceName: (deviceName: string) => void
  readonly destinationKind: PrintDestinationKind
  readonly systemDialog: boolean
  readonly isSavePdf: boolean
  readonly isSaveImages: boolean
  readonly isSave: boolean
  readonly saveRestricted: boolean
  readonly allowSaveDestinations: boolean
  /** true when an in-app printer is chosen ('' = OS default, or a named printer) */
  readonly isSilent: boolean
  readonly copies: number
  readonly setCopies: (copies: number) => void
  readonly collate: boolean
  readonly collateLocked: boolean
  readonly setCollate: (collate: boolean) => void
  readonly duplex: PrintLayoutDuplex
  readonly setDuplex: (duplex: PrintLayoutDuplex) => void
  readonly imageOptions: ImageExportOptions
  readonly setImageOptions: (patch: Partial<ImageExportOptions>) => void
  readonly job: PrintJobSelection
}

// macOS's print sheet already carries copies/duplex/paper, so it stays the
// default there; Windows 11's dialog buries duplex under "More settings".
function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
}

function defaultDestination(): string {
  return isMacPlatform() ? SYSTEM_DIALOG : DEFAULT_PRINTER
}

export function destinationKindOf(deviceName: string): PrintDestinationKind {
  if (deviceName === SYSTEM_DIALOG) return 'system'
  if (deviceName === SAVE_PDF_DEST) return 'save-pdf'
  if (deviceName === SAVE_IMAGES_DEST) return 'save-images'
  return 'printer'
}

/**
 * In-app destination (OS printer, Save as PDF, Save as images, or System print
 * dialog), copies, collate, duplex, and image export state coupled to the
 * shared page layout options. Starts fresh from defaults every time the dialog
 * mounts.
 */
export function usePrintJob(
  options: PrintLayoutOptions,
  listPrinters?: (() => Promise<readonly PrintPrinterInfo[]>) | undefined,
  config?: UsePrintJobConfig | undefined,
): PrintJobState {
  const saveRestricted = config?.saveRestricted === true
  const allowSaveDestinations = config?.allowSaveDestinations !== false
  const [printers, setPrinters] = useState<readonly PrintPrinterInfo[]>([])
  const [deviceName, setDeviceNameRaw] = useState<string>(() => {
    const initial = config?.initialDestination
    if (initial === undefined) return defaultDestination()
    if (
      (saveRestricted || !allowSaveDestinations) &&
      (initial === SAVE_PDF_DEST || initial === SAVE_IMAGES_DEST)
    ) {
      return defaultDestination()
    }
    return initial
  })
  const [copies, setCopiesRaw] = useState(1)
  const [collateRaw, setCollate] = useState(true)
  const [imageOptions, setImageOptionsRaw] = useState<ImageExportOptions>(
    createDefaultImageExportOptions,
  )
  const { duplex, setDuplex } = useDuplexCoupling(options, 'simplex')
  const listRef = useRef(listPrinters)
  listRef.current = listPrinters

  useEffect(() => {
    const load = listRef.current
    if (!load) return
    let alive = true
    load()
      .then((list) => {
        if (alive && Array.isArray(list)) setPrinters(list)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  // Never stay on a save destination if the document restricts saving.
  useEffect(() => {
    if (
      (saveRestricted || !allowSaveDestinations) &&
      (deviceName === SAVE_PDF_DEST || deviceName === SAVE_IMAGES_DEST)
    ) {
      setDeviceNameRaw(defaultDestination())
    }
  }, [saveRestricted, allowSaveDestinations, deviceName])

  const setDeviceName = useCallback(
    (next: string) => {
      if (
        (saveRestricted || !allowSaveDestinations) &&
        (next === SAVE_PDF_DEST || next === SAVE_IMAGES_DEST)
      ) {
        return
      }
      setDeviceNameRaw(next)
    },
    [saveRestricted, allowSaveDestinations],
  )

  const setCopies = useCallback((next: number) => {
    setCopiesRaw(Math.min(999, Math.max(1, Math.round(next) || 1)))
  }, [])

  const setImageOptions = useCallback((patch: Partial<ImageExportOptions>) => {
    setImageOptionsRaw((prev) => ({ ...prev, ...patch }))
  }, [])

  const destinationKind = destinationKindOf(deviceName)
  const systemDialog = destinationKind === 'system'
  const isSavePdf = destinationKind === 'save-pdf'
  const isSaveImages = destinationKind === 'save-images'
  const isSave = isSavePdf || isSaveImages
  const isSilent = destinationKind === 'printer'
  const collateLocked = isCollateLocked(options)
  const collate = effectiveCollate(options, collateRaw)

  const job = useMemo<PrintJobSelection>(
    () => (isSilent ? { deviceName, copies, collate, duplex } : { deviceName: null }),
    [isSilent, deviceName, copies, collate, duplex],
  )

  return {
    printers,
    deviceName,
    setDeviceName,
    destinationKind,
    systemDialog,
    isSavePdf,
    isSaveImages,
    isSave,
    saveRestricted,
    allowSaveDestinations,
    isSilent,
    copies,
    setCopies,
    collate,
    collateLocked,
    setCollate,
    duplex,
    setDuplex,
    imageOptions,
    setImageOptions,
    job,
  }
}

/**
 * Options state for a print dialog that starts from the defaults every time
 * `open` turns true (spec 4: nothing carries over between prints).
 */
export function usePrintLayoutOptions(
  open: boolean,
): [PrintLayoutOptions, (next: PrintLayoutOptions) => void] {
  const [options, setOptions] = useState<PrintLayoutOptions>(createDefaultOptions)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setOptions(createDefaultOptions())
  }
  return [options, setOptions]
}

/**
 * The word editor's duplex field coupled to the panel (spec 4.6). Pass the
 * panel's options each render; `setDuplex` is for the user's own changes.
 */
export function useDuplexCoupling(
  options: PrintLayoutOptions,
  initial: PrintLayoutDuplex,
): { duplex: PrintLayoutDuplex; setDuplex: (duplex: PrintLayoutDuplex) => void } {
  const [state, setState] = useState<DuplexCoupling>(() => createDuplexCoupling(initial))
  const [seen, setSeen] = useState(options)
  if (seen !== options) {
    setSeen(options)
    setState(coupleDuplex(state, seen, options))
  }
  const setDuplex = useCallback(
    (duplex: PrintLayoutDuplex) => setState((s) => setDuplexByUser(s, duplex)),
    [],
  )
  return { duplex: state.duplex, setDuplex }
}

/**
 * Builds the arranged result as one PNG per face. The editor reports progress
 * and stops (rejecting or resolving, either is fine) when `signal` aborts.
 */
export type PrintLayoutPreviewRequest = (
  options: PrintLayoutOptions,
  context: { signal: AbortSignal; onProgress: (progress: PrintLayoutProgress) => void },
) => Promise<Uint8Array[]>

export type ArrangedPreviewState =
  | { status: 'idle' }
  | { status: 'running'; progress: PrintLayoutProgress | null }
  | { status: 'done'; faces: readonly Uint8Array[] }
  | { status: 'failed' }

/** Runs a preview request with cancel; a newer start or unmount aborts the older run. */
export function useArrangedPreview(request: PrintLayoutPreviewRequest | undefined): {
  state: ArrangedPreviewState
  start: (options: PrintLayoutOptions) => void
  cancel: () => void
} {
  const [state, setState] = useState<ArrangedPreviewState>({ status: 'idle' })
  const controller = useRef<AbortController | null>(null)
  const requestRef = useRef(request)
  requestRef.current = request

  const cancel = useCallback(() => {
    controller.current?.abort()
    controller.current = null
    setState((s) => (s.status === 'idle' ? s : { status: 'idle' }))
  }, [])

  const start = useCallback((options: PrintLayoutOptions) => {
    const run = requestRef.current
    if (!run) return
    controller.current?.abort()
    const c = new AbortController()
    controller.current = c
    setState({ status: 'running', progress: null })
    let pending: Promise<Uint8Array[]>
    try {
      pending = run(options, {
        signal: c.signal,
        onProgress: (progress) => {
          if (!c.signal.aborted) setState({ status: 'running', progress })
        },
      })
    } catch {
      pending = Promise.reject(new Error('preview request failed'))
    }
    pending.then(
      (faces) => {
        if (c.signal.aborted) return
        controller.current = null
        setState({ status: 'done', faces })
      },
      () => {
        if (c.signal.aborted) return
        controller.current = null
        setState({ status: 'failed' })
      },
    )
  }, [])

  useEffect(() => () => controller.current?.abort(), [])

  return { state, start, cancel }
}
