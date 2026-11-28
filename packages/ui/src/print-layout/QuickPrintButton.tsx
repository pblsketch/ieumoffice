import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import type { Lang } from '@genoffice/i18n'
import { useModalKeys } from '../modal-keys'
import { printLayoutText } from '../strings-print-layout'
import { SAVE_IMAGES_DEST, SAVE_PDF_DEST, type PrintPrinterInfo } from './hooks'
import './print-layout.css'

/** Documents with at least this many pages prompt once before direct Quick Print. */
export const QUICK_PRINT_CONFIRM_THRESHOLD = 20

const LOCAL_STORAGE_KEY = 'ieumoffice.quickPrintOnClick'

export interface QuickPrintPrefStore {
  getQuickPrintPref?(): Promise<boolean>
  setQuickPrintPref?(enabled: boolean): Promise<boolean>
  onQuickPrintPrefChanged?(listener: (enabled: boolean) => void): () => void
}

/** Pick the display label of the OS default printer, falling back to `fallbackLabel`. */
export function defaultPrinterLabel(
  printers: readonly PrintPrinterInfo[] | null | undefined,
  fallbackLabel: string,
): string {
  if (!printers || printers.length === 0) return fallbackLabel
  const def = printers.find((p) => p.isDefault) ?? printers[0]
  return def?.displayName || def?.name || fallbackLabel
}

/**
 * App-wide preference for whether clicking the top-bar Print button triggers
 * Quick Print immediately (false by default: opens the print preview dialog).
 */
export function useQuickPrintPref(
  store?: QuickPrintPrefStore | undefined,
): [boolean, (enabled: boolean) => void] {
  const [clickToQuickPrint, setState] = useState<boolean>(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(LOCAL_STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })
  const storeRef = useRef(store)
  storeRef.current = store

  useEffect(() => {
    const api = storeRef.current
    if (!api) return
    let alive = true
    api
      .getQuickPrintPref?.()
      .then((value) => {
        if (!alive) return
        setState(value === true)
        try {
          localStorage.setItem(LOCAL_STORAGE_KEY, value ? '1' : '0')
        } catch {
          // ignore storage failures
        }
      })
      .catch(() => undefined)
    const off = api.onQuickPrintPrefChanged?.((value) => {
      if (!alive) return
      setState(value === true)
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, value ? '1' : '0')
      } catch {
        // ignore storage failures
      }
    })
    return () => {
      alive = false
      off?.()
    }
  }, [store])

  const setPref = useCallback((enabled: boolean) => {
    const next = enabled === true
    setState(next)
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, next ? '1' : '0')
    } catch {
      // ignore storage failures
    }
    void storeRef.current?.setQuickPrintPref?.(next)?.catch(() => undefined)
  }, [])

  return [clickToQuickPrint, setPref]
}

function PrinterGlyph({ quick }: { quick: boolean }): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 9V4h12v5M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v6H6v-6Z"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {quick && (
        <path
          className="gs-qp-bolt"
          d="M19.5 2L14.5 9h3.2L16.5 14l5-7h-3.2L19.5 2Z"
          fill="currentColor"
        />
      )}
    </svg>
  )
}

function CaretGlyph(): ReactElement {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M3 4.5L6 7.5L9 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
}

export interface QuickPrintButtonProps {
  lang: Lang
  /** Disables the split button (e.g. no open document or printing restricted). */
  disabled?: boolean | undefined
  /** True while a quick-print job is in progress (prevents double-click duplicate prints). */
  busy?: boolean | undefined
  /** True for permission-restricted PDFs: disables Save as PDF & Save as images in the menu. */
  saveRestricted?: boolean | undefined
  /** Visual variant: compact QAT icon button (default) or labeled button (e.g. Whiteboard header). */
  variant?: 'icon' | 'labeled' | undefined
  /** Preferred horizontal menu alignment relative to the button. */
  align?: 'left' | 'right' | undefined
  /** Optional extra CSS class on the outer container. */
  className?: string | undefined
  /** Lists installed OS printers (used to display the default printer name & detect no-printer fallback). */
  listPrinters?: (() => Promise<readonly PrintPrinterInfo[]>) | undefined
  /** Shared preference store (`printLayout` bridge). */
  prefStore?: QuickPrintPrefStore | undefined
  /** Returns current document page count for the >=20 page Quick Print confirmation guard. */
  getPageCount?: (() => number | null | Promise<number | null>) | undefined
  /** Opens the editor's print dialog, optionally pre-selecting Save as PDF or Save as images. */
  onOpenDialog: (initialDestination?: string) => void
  /** Runs direct silent Quick Print to the OS default printer (1 copy, default options). */
  onQuickPrint: (printerLabel: string) => void | Promise<void>
  /** Optional notice callback when falling back to the dialog because no OS printer is installed. */
  onNoPrinter?: ((message: string) => void) | undefined
}

interface PendingConfirm {
  pages: number
  printerLabel: string
}

function QuickPrintConfirmDialog({
  lang,
  pending,
  onCancel,
  onOpenDialog,
  onProceed,
}: {
  lang: Lang
  pending: PendingConfirm
  onCancel: () => void
  onOpenDialog: () => void
  onProceed: () => void
}): ReactElement {
  const modalKeys = useModalKeys(onCancel, { restoreFocus: true })
  return createPortal(
    <div
      className="gs-pl-mask gs-qp-confirm-mask"
      data-quick-print="confirm-mask"
      onClick={onCancel}
    >
      <div
        className="gs-pl-dialog gs-qp-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-label={printLayoutText(lang, 'quickPrintConfirmTitle')}
        data-quick-print="confirm-dialog"
        onClick={(e) => e.stopPropagation()}
        {...modalKeys}
      >
        <div className="gs-pl-dialog-title">{printLayoutText(lang, 'quickPrintConfirmTitle')}</div>
        <p className="gs-qp-confirm-body">
          {printLayoutText(lang, 'quickPrintConfirmBody', {
            pages: pending.pages,
            printer: pending.printerLabel,
          })}
        </p>
        <div className="gs-pl-dialog-actions">
          <span className="gs-pl-spacer" />
          <button
            type="button"
            className="gs-pl-btn"
            data-quick-print="confirm-cancel"
            onClick={onCancel}
          >
            {printLayoutText(lang, 'cancel')}
          </button>
          <button
            type="button"
            className="gs-pl-btn"
            data-quick-print="confirm-open-dialog"
            onClick={onOpenDialog}
          >
            {printLayoutText(lang, 'quickPrintConfirmOpenDialog')}
          </button>
          <button
            type="button"
            className="gs-pl-btn primary"
            data-quick-print="confirm-proceed"
            onClick={onProceed}
          >
            {printLayoutText(lang, 'quickPrintNow')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * Top-bar Quick Print split button (`[ 🖨 | ▾ ]`) shared by all editors.
 *
 * - Default main-button click opens the editor's print preview dialog (`Ctrl+P`),
 *   matching user expectations and preventing accidental paper waste.
 * - Caret (`▾`) opens a dropdown with Quick Print (OS default printer, 1 copy),
 *   Print preview, Save as PDF, Save as images, and an app-wide toggle to make
 *   main-button click trigger Quick Print directly.
 * - Documents with >= 20 pages prompt once with Cancel / Open print dialog / Quick Print.
 */
export function QuickPrintButton({
  lang,
  disabled = false,
  busy = false,
  saveRestricted = false,
  variant = 'icon',
  align = 'left',
  className,
  listPrinters,
  prefStore,
  getPageCount,
  onOpenDialog,
  onQuickPrint,
  onNoPrinter,
}: QuickPrintButtonProps): ReactElement {
  const [clickToQuickPrint, setClickToQuickPrint] = useQuickPrintPref(prefStore)
  const [menuOpen, setMenuOpen] = useState(false)
  const [printers, setPrinters] = useState<readonly PrintPrinterInfo[] | null>(null)
  const [running, setRunning] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef(listPrinters)
  listRef.current = listPrinters

  const fallbackPrinter = printLayoutText(lang, 'defaultPrinter')
  const printerLabel = defaultPrinterLabel(printers, fallbackPrinter)
  const effectiveBusy = busy || running
  const effectiveDisabled = disabled || effectiveBusy
  const shortcut = isMacPlatform() ? '⌘P' : 'Ctrl+P'

  const refreshPrinters = useCallback(async (): Promise<readonly PrintPrinterInfo[] | null> => {
    const loader = listRef.current
    if (!loader) return null
    try {
      const list = await loader()
      const safe = Array.isArray(list) ? list : []
      setPrinters(safe)
      return safe
    } catch {
      return null
    }
  }, [])

  // Refresh default printer name lazily when opening the menu (or once when quick-print mode is on).
  useEffect(() => {
    if (menuOpen || clickToQuickPrint) {
      void refreshPrinters()
    }
  }, [menuOpen, clickToQuickPrint, refreshPrinters])

  // Position the portal dropdown cleanly inside the viewport.
  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPos(null)
      return
    }
    const anchor = rootRef.current
    if (!anchor) return
    const update = () => {
      const rect = anchor.getBoundingClientRect()
      const menuW = menuRef.current?.offsetWidth || 252
      const menuH = menuRef.current?.offsetHeight || 220
      const margin = 8
      let left = align === 'right' ? rect.right - menuW : rect.left
      if (left + menuW > window.innerWidth - margin) {
        left = Math.max(margin, window.innerWidth - menuW - margin)
      }
      if (left < margin) left = margin
      let top = rect.bottom + 4
      if (top + menuH > window.innerHeight - margin && rect.top - menuH - 4 >= margin) {
        top = rect.top - menuH - 4
      }
      setMenuPos({ top: Math.round(top), left: Math.round(left) })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [menuOpen, align])

  // Close menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setMenuOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [menuOpen])

  const executeQuickPrint = useCallback(
    async (resolvedPrinter: string) => {
      setRunning(true)
      try {
        await onQuickPrint(resolvedPrinter)
      } finally {
        setRunning(false)
      }
    },
    [onQuickPrint],
  )

  const triggerQuickPrint = useCallback(async () => {
    if (effectiveDisabled) return
    setMenuOpen(false)
    const list = await refreshPrinters()
    // When OS reports zero installed printers, open the print dialog so the user can pick PDF/images.
    if (list !== null && list.length === 0) {
      onNoPrinter?.(printLayoutText(lang, 'quickPrintNoPrinter'))
      onOpenDialog()
      return
    }
    const resolvedPrinter = defaultPrinterLabel(list ?? printers, fallbackPrinter)
    let count: number | null = null
    if (getPageCount) {
      try {
        const raw = await getPageCount()
        if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) count = Math.round(raw)
      } catch {
        count = null
      }
    }
    if (count !== null && count >= QUICK_PRINT_CONFIRM_THRESHOLD) {
      setPendingConfirm({ pages: count, printerLabel: resolvedPrinter })
      return
    }
    await executeQuickPrint(resolvedPrinter)
  }, [
    effectiveDisabled,
    refreshPrinters,
    printers,
    fallbackPrinter,
    getPageCount,
    executeQuickPrint,
    onNoPrinter,
    onOpenDialog,
    lang,
  ])

  const handleMainClick = () => {
    if (effectiveDisabled) return
    setMenuOpen(false)
    if (clickToQuickPrint) {
      void triggerQuickPrint()
    } else {
      onOpenDialog()
    }
  }

  const mainTip = clickToQuickPrint
    ? printLayoutText(lang, 'quickPrintDirectTooltip', { printer: printerLabel })
    : `${printLayoutText(lang, 'print')} (${shortcut})`

  const menuTitle = printLayoutText(lang, 'quickPrintMenuLabel')

  const menuPortal =
    menuOpen && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            className="gs-qp-menu"
            role="menu"
            aria-label={menuTitle}
            data-quick-print="menu"
            style={
              menuPos
                ? { top: `${menuPos.top}px`, left: `${menuPos.left}px` }
                : { top: '-9999px', left: '-9999px' }
            }
          >
            <button
              type="button"
              role="menuitem"
              className="gs-qp-item gs-qp-item-col"
              data-quick-print="quick-print"
              disabled={effectiveDisabled}
              onClick={() => void triggerQuickPrint()}
            >
              <span className="gs-qp-item-title">{printLayoutText(lang, 'quickPrintNow')}</span>
              <span className="gs-qp-item-sub">
                {printLayoutText(lang, 'quickPrintNowSub', { printer: printerLabel })}
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="gs-qp-item"
              data-quick-print="open-dialog"
              disabled={effectiveDisabled}
              onClick={() => {
                setMenuOpen(false)
                onOpenDialog()
              }}
            >
              <span className="gs-qp-item-title">
                {printLayoutText(lang, 'quickPrintOpenDialog')}
              </span>
              <kbd className="gs-qp-kbd">{shortcut}</kbd>
            </button>
            <div className="gs-qp-sep" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="gs-qp-item"
              data-quick-print="save-pdf"
              disabled={effectiveDisabled || saveRestricted}
              title={saveRestricted ? printLayoutText(lang, 'saveRestricted') : undefined}
              onClick={() => {
                setMenuOpen(false)
                onOpenDialog(SAVE_PDF_DEST)
              }}
            >
              <span className="gs-qp-item-title">{printLayoutText(lang, 'quickPrintSavePdf')}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="gs-qp-item"
              data-quick-print="save-images"
              disabled={effectiveDisabled || saveRestricted}
              title={saveRestricted ? printLayoutText(lang, 'saveRestricted') : undefined}
              onClick={() => {
                setMenuOpen(false)
                onOpenDialog(SAVE_IMAGES_DEST)
              }}
            >
              <span className="gs-qp-item-title">
                {printLayoutText(lang, 'quickPrintSaveImages')}
              </span>
            </button>
            {saveRestricted && (
              <div className="gs-qp-note" data-quick-print="save-restricted-note">
                {printLayoutText(lang, 'saveRestricted')}
              </div>
            )}
            <div className="gs-qp-sep" role="separator" />
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={clickToQuickPrint}
              className="gs-qp-item gs-qp-toggle"
              data-quick-print="toggle-default"
              onClick={() => setClickToQuickPrint(!clickToQuickPrint)}
            >
              <span className="gs-qp-check" aria-hidden="true">
                {clickToQuickPrint ? '✓' : ''}
              </span>
              <span className="gs-qp-item-title">
                {printLayoutText(lang, 'quickPrintClickToggle')}
              </span>
            </button>
          </div>,
          document.body,
        )
      : null

  const confirmPortal =
    pendingConfirm && typeof document !== 'undefined' ? (
      <QuickPrintConfirmDialog
        lang={lang}
        pending={pendingConfirm}
        onCancel={() => setPendingConfirm(null)}
        onOpenDialog={() => {
          setPendingConfirm(null)
          onOpenDialog()
        }}
        onProceed={() => {
          const target = pendingConfirm.printerLabel
          setPendingConfirm(null)
          void executeQuickPrint(target)
        }}
      />
    ) : null

  return (
    <div
      ref={rootRef}
      className={`gs-qp${variant === 'labeled' ? ' gs-qp-labeled' : ''}${clickToQuickPrint ? ' gs-qp-direct' : ''}${effectiveBusy ? ' gs-qp-busy' : ''}${className ? ` ${className}` : ''}`}
      data-quick-print="root"
    >
      <button
        type="button"
        className="gs-qp-main"
        data-quick-print="main"
        data-tip={mainTip}
        aria-label={mainTip}
        disabled={effectiveDisabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleMainClick}
      >
        <PrinterGlyph quick={clickToQuickPrint} />
        {variant === 'labeled' && (
          <span className="gs-qp-label">
            {printLayoutText(lang, clickToQuickPrint ? 'quickPrintNow' : 'print')}
          </span>
        )}
      </button>
      <button
        type="button"
        className="gs-qp-caret"
        data-quick-print="menu-toggle"
        data-tip={menuTitle}
        aria-label={menuTitle}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        disabled={effectiveDisabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <CaretGlyph />
      </button>
      {menuPortal}
      {confirmPortal}
    </div>
  )
}
