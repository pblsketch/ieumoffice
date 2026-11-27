import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createStudio, type RhwpEditor } from '@rhwp/editor'
import type { Lang } from '@genoffice/i18n'
import type { DocumentMode } from '@genoffice/mobile-bridge/view-edit-gate'
import type { MobileTheme } from '@genoffice/mobile-bridge/transport'
import {
  MOBILE_STUDIO_SETTINGS_KEY,
  mobileHwpStudioUrl,
  seedMobileHwpStudioSettings,
  type MobileHwpEditorPort,
} from '@genoffice/mobile-bridge/hwp'
import blankHwpUrl from '../../../../hwp/src/renderer/assets/blank.hwp?url'
import { registerMobileKoreanFonts } from '../assets/fonts'
import { attachPinchZoom } from './pinchZoom'

export type HwpQuickAction =
  | 'undo'
  | 'redo'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'fontBigger'
  | 'fontSmaller'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'alignJustify'
  | 'lineSpacingWider'
  | 'lineSpacingNarrower'
  | 'bulletList'
  | 'numberedList'
  | 'insertTable'
  | 'insertImage'

/** rhwp-studio command for each mobile action. */
const HWP_ACTION_COMMANDS: Record<HwpQuickAction, string> = {
  undo: 'edit:undo',
  redo: 'edit:redo',
  bold: 'format:bold',
  italic: 'format:italic',
  underline: 'format:underline',
  strikethrough: 'format:strikethrough',
  fontBigger: 'format:font-size-increase',
  fontSmaller: 'format:font-size-decrease',
  alignLeft: 'format:align-left',
  alignCenter: 'format:align-center',
  alignRight: 'format:align-right',
  alignJustify: 'format:align-justify',
  lineSpacingWider: 'format:line-spacing-increase',
  lineSpacingNarrower: 'format:line-spacing-decrease',
  bulletList: 'format:toggle-bullet',
  numberedList: 'format:toggle-numbering',
  insertTable: 'table:create',
  insertImage: 'insert:image',
}

export interface HwpMobileEditorHandle {
  readonly getSavePort: () => MobileHwpEditorPort
  readonly runAction: (action: HwpQuickAction) => void
  readonly fitToWidth: () => void
  /** Replaces the open document with these bytes (edits handed over from the flow view). */
  readonly loadBytes: (bytes: Uint8Array) => Promise<void>
  /**
   * Calls a method of the app's page-editor plugin (apps/hwp/studio-plugin/agent-plugin.mjs,
   * shipped in the same studio bundle), loading it on first use as the PC bridge does.
   */
  readonly callPlugin: (method: string, ...args: unknown[]) => Promise<unknown>
}

export interface HwpMobileEditorProps {
  readonly fileName: string
  readonly documentBytes: Uint8Array | null
  readonly mode: DocumentMode
  readonly canEdit?: boolean
  readonly hidden?: boolean
  readonly lang: Lang
  readonly theme: MobileTheme
  readonly onDirty: () => void
  readonly onReady?: () => void
  readonly onError?: (message: string) => void
}

/** Matches `PASSWORD_FLAG` in `apps/hwp/scripts/rhwp-patches.mjs`. */
const PASSWORD_FLAG = 'passwordProtected'
const STUDIO_DIRTY_EVENT = 'ieum:dirty'
/** Id of the app's studio plugin (AGENT_PLUGIN_ID in apps/hwp/studio-plugin/agent-plugin.mjs). */
const AGENT_PLUGIN_ID = 'ieum-agent'
const DIRTY_POLL_MS = 2000

const MOBILE_HIDDEN_CHROME = {
  menu: false,
  toolbar: false,
  statusbar: false,
} as const

/** Studio zoom bounds (mirrors rhwp-studio's 10%-500% range, clamped to 25%-400% for pinch). */
const STUDIO_PINCH_MIN = 0.25
const STUDIO_PINCH_MAX = 4
const STUDIO_SLIDER_MIN_PCT = 10
const STUDIO_SLIDER_MID_PCT = 100
const STUDIO_SLIDER_MAX_PCT = 500
const STUDIO_SLIDER_MAX = 1000
const STUDIO_SLIDER_MID = 500

/**
 * Maps a zoom percentage (10..500) to rhwp-studio's logarithmic `#sb-zoom-range`
 * slider value (0..1000, midpoint 500 = 100%).
 */
export function studioZoomPercentToSlider(percent: number): number {
  const clamped = Number.isFinite(percent)
    ? Math.max(STUDIO_SLIDER_MIN_PCT, Math.min(STUDIO_SLIDER_MAX_PCT, percent))
    : STUDIO_SLIDER_MID_PCT
  if (clamped === STUDIO_SLIDER_MID_PCT) return STUDIO_SLIDER_MID
  if (clamped < STUDIO_SLIDER_MID_PCT) {
    const t =
      Math.log(clamped / STUDIO_SLIDER_MIN_PCT) /
      Math.log(STUDIO_SLIDER_MID_PCT / STUDIO_SLIDER_MIN_PCT)
    return Math.round(t * STUDIO_SLIDER_MID)
  }
  const t =
    Math.log(clamped / STUDIO_SLIDER_MID_PCT) /
    Math.log(STUDIO_SLIDER_MAX_PCT / STUDIO_SLIDER_MID_PCT)
  return Math.round(STUDIO_SLIDER_MID + t * (STUDIO_SLIDER_MAX - STUDIO_SLIDER_MID))
}

/** Reads the studio's current zoom ratio synchronously from `#sb-zoom-range`. */
export function readStudioZoom(doc: Document): number {
  const slider = doc.getElementById('sb-zoom-range') as HTMLInputElement | null
  const text = slider?.getAttribute('aria-valuetext') ?? ''
  const match = /(\d+(?:\.\d+)?)%/.exec(text)
  if (match) {
    const pct = Number(match[1])
    if (Number.isFinite(pct) && pct > 0) return pct / 100
  }
  return 1
}

/** Commits a target zoom ratio into rhwp-studio (via slider input, else zoom-in/out commands). */
function applyStudioZoom(doc: Document, editor: RhwpEditor, targetZoom: number): void {
  const clamped = Math.max(STUDIO_PINCH_MIN, Math.min(STUDIO_PINCH_MAX, targetZoom))
  const slider = doc.getElementById('sb-zoom-range') as HTMLInputElement | null
  if (slider) {
    const pct = Math.round(clamped * 100)
    slider.value = String(studioZoomPercentToSlider(pct))
    slider.dispatchEvent(new Event('input', { bubbles: true }))
    return
  }
  const current = readStudioZoom(doc)
  const diff = clamped - current
  if (Math.abs(diff) < 0.05) return
  const cmd = diff > 0 ? 'view:zoom-in' : 'view:zoom-out'
  void editor.commands.execute(cmd).catch(() => {})
}

/**
 * Strips desktop centimeter rulers inside the same-origin rhwp-studio iframe on
 * narrow phone viewports so the Hangul page uses the full width cleanly, and
 * disables browser-level page zoom inside the iframe so our pinch handler owns zoom.
 */
function applyMobileStudioCanvasStyle(editor: RhwpEditor): void {
  try {
    const doc = editor.element?.contentDocument
    if (!doc?.head) return
    const viewportMeta = doc.querySelector('meta[name="viewport"]')
    const lockedViewport =
      'width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no'
    if (viewportMeta) {
      viewportMeta.setAttribute('content', lockedViewport)
    } else {
      const meta = doc.createElement('meta')
      meta.name = 'viewport'
      meta.content = lockedViewport
      doc.head.appendChild(meta)
    }
    const existing = doc.getElementById('ieum-mobile-studio-style')
    if (existing) return
    const style = doc.createElement('style')
    style.id = 'ieum-mobile-studio-style'
    style.textContent = `
      html,
      body,
      #scroll-container {
        touch-action: pan-x pan-y;
      }
      /* compact and medium window classes (< 840px, see useViewportLayout) */
      @media (max-width: 839px) {
        #ruler-corner,
        #h-ruler,
        #v-ruler {
          display: none !important;
        }
        #editor-area {
          grid-template-columns: 0 1fr !important;
          grid-template-rows: 0 1fr !important;
        }
        #scroll-container {
          grid-column: 1 / -1 !important;
          grid-row: 1 / -1 !important;
        }
      }
    `
    doc.head.appendChild(style)
  } catch {
    // Ignore cross-origin restrictions in non-same-origin test harnesses.
  }
}

/** Attaches document-only two-finger pinch-zoom to the same-origin rhwp-studio iframe. */
function attachStudioPinchZoom(editor: RhwpEditor): (() => void) | null {
  try {
    const doc = editor.element?.contentDocument
    if (!doc) return null
    const content = doc.getElementById('scroll-content')
    return attachPinchZoom(doc, {
      getScale: () => readStudioZoom(doc),
      min: STUDIO_PINCH_MIN,
      max: STUDIO_PINCH_MAX,
      onPreview: (_scale, ratio) => {
        if (!content) return
        if (Math.abs(ratio - 1) < 0.005) {
          content.style.transform = ''
          content.style.transformOrigin = ''
        } else {
          content.style.transformOrigin = 'top left'
          content.style.transform = `scale(${ratio})`
        }
      },
      onCommit: (nextScale) => {
        if (content) {
          content.style.transform = ''
          content.style.transformOrigin = ''
        }
        applyStudioZoom(doc, editor, nextScale)
      },
    })
  } catch {
    return null
  }
}

/** Calls `.blur()` across iframe realms without relying on parent `instanceof HTMLElement`. */
function blurElement(node: unknown): void {
  if (node && typeof node === 'object' && 'blur' in node && typeof node.blur === 'function') {
    ;(node as { blur: () => void }).blur()
  }
}

/** Locks or unlocks text-input elements inside the same-origin rhwp-studio iframe. */
function syncStudioEditLock(editor: RhwpEditor, interactive: boolean): void {
  try {
    const iframe = editor.element
    const doc = iframe?.contentDocument
    if (!doc) return
    const fields = doc.querySelectorAll('textarea, input:not([type="range"]), [contenteditable]')
    for (const node of fields) {
      const tag = node.tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') {
        const field = node as HTMLTextAreaElement | HTMLInputElement
        field.readOnly = !interactive
        field.inputMode = interactive ? '' : 'none'
        field.tabIndex = interactive ? 0 : -1
      } else {
        const el = node as HTMLElement
        if (!interactive) {
          if (!el.hasAttribute('data-ieum-ce')) {
            el.setAttribute('data-ieum-ce', el.getAttribute('contenteditable') ?? 'true')
          }
          el.setAttribute('contenteditable', 'false')
          el.tabIndex = -1
        } else if (el.hasAttribute('data-ieum-ce')) {
          el.setAttribute('contenteditable', el.getAttribute('data-ieum-ce') ?? 'true')
          el.removeAttribute('data-ieum-ce')
          el.tabIndex = 0
        }
      }
    }
    if (!interactive) {
      blurElement(doc.activeElement)
      if (typeof document !== 'undefined' && document.activeElement === iframe) {
        blurElement(iframe)
      }
    }
  } catch {
    // Ignore cross-origin restrictions in non-same-origin test harnesses.
  }
}

/**
 * Blocks focus, virtual keyboard activation, and typing mutations inside the same-origin
 * rhwp-studio iframe whenever the mobile view is read-only, in view mode, or hidden under
 * the flow reading view, while leaving scrolling and pinch-zoom intact.
 */
function attachStudioReadOnlyGuard(
  editor: RhwpEditor,
  isInteractive: () => boolean,
): (() => void) | null {
  try {
    const doc = editor.element?.contentDocument
    if (!doc) return null

    const blockFocus = (event: Event) => {
      if (isInteractive()) return
      syncStudioEditLock(editor, false)
      blurElement(event.target)
      blurElement(editor.element)
    }

    const blockInput = (event: Event) => {
      if (isInteractive()) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    const inputEvents = [
      'beforeinput',
      'keydown',
      'keypress',
      'compositionstart',
      'paste',
      'cut',
    ] as const
    doc.addEventListener('focusin', blockFocus, true)
    for (const name of inputEvents) doc.addEventListener(name, blockInput, true)

    let observer: MutationObserver | null = null
    if (typeof MutationObserver !== 'undefined' && doc.body) {
      observer = new MutationObserver(() => {
        if (!isInteractive()) syncStudioEditLock(editor, false)
      })
      observer.observe(doc.body, { childList: true, subtree: true })
    }

    syncStudioEditLock(editor, isInteractive())

    return () => {
      observer?.disconnect()
      doc.removeEventListener('focusin', blockFocus, true)
      for (const name of inputEvents) doc.removeEventListener(name, blockInput, true)
    }
  } catch {
    return null
  }
}

export const HwpMobileEditor = forwardRef<HwpMobileEditorHandle, HwpMobileEditorProps>(
  function HwpMobileEditor(
    {
      fileName,
      documentBytes,
      mode,
      canEdit = true,
      hidden = false,
      lang,
      theme,
      onDirty,
      onReady,
      onError,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const editorRef = useRef<RhwpEditor | null>(null)
    const pluginLoadedRef = useRef<{ editor: RhwpEditor; ready: Promise<unknown> } | null>(null)
    const [loading, setLoading] = useState(true)

    // Keep callback props in refs so parent re-renders never tear down and reload rhwp-studio.
    const onDirtyRef = useRef(onDirty)
    onDirtyRef.current = onDirty
    const onReadyRef = useRef(onReady)
    onReadyRef.current = onReady
    const onErrorRef = useRef(onError)
    onErrorRef.current = onError
    const fileNameRef = useRef(fileName)
    fileNameRef.current = fileName
    const interactiveEdit = mode === 'edit' && canEdit && !hidden
    const interactiveEditRef = useRef(interactiveEdit)
    interactiveEditRef.current = interactiveEdit

    useEffect(() => {
      if (editorRef.current) {
        syncStudioEditLock(editorRef.current, interactiveEdit)
      }
    }, [interactiveEdit])

    useEffect(() => {
      let cancelled = false
      let dirtyPoll: ReturnType<typeof setInterval> | null = null
      let frameWindow: Window | null = null
      let disposePinch: (() => void) | null = null
      let disposeReadOnlyGuard: (() => void) | null = null
      let lastReportedDirty = false
      const container = containerRef.current
      if (!container) return
      setLoading(true)

      const onFrameDirty = (event: Event) => {
        if (!interactiveEditRef.current) return
        const isDirty = (event as CustomEvent<unknown>).detail === true
        if (isDirty && !lastReportedDirty) {
          lastReportedDirty = true
          onDirtyRef.current()
        }
      }

      void (async () => {
        try {
          // Force Canvas2D renderer (no canvaskit-wasm) and disable studio draft autosave.
          if (typeof localStorage !== 'undefined') {
            const current = localStorage.getItem(MOBILE_STUDIO_SETTINGS_KEY)
            localStorage.setItem(
              MOBILE_STUDIO_SETTINGS_KEY,
              seedMobileHwpStudioSettings(current, theme),
            )
          }
          await registerMobileKoreanFonts()
          if (cancelled) return

          const studioUrl = mobileHwpStudioUrl(lang)
          const editor = await createStudio(container, {
            studioUrl,
            renderer: 'canvas2d',
            chrome: MOBILE_HIDDEN_CHROME,
          })
          if (cancelled) {
            editor.destroy()
            return
          }
          editorRef.current = editor

          // Hide desktop menu/toolbar/statusbar chrome and phone centimeter rulers.
          await editor.chrome.set(MOBILE_HIDDEN_CHROME).catch(() => {})
          applyMobileStudioCanvasStyle(editor)
          disposePinch = attachStudioPinchZoom(editor)
          disposeReadOnlyGuard = attachStudioReadOnlyGuard(editor, () => interactiveEditRef.current)
          if (cancelled) return

          if (documentBytes && documentBytes.byteLength > 0) {
            await editor.loadFile(documentBytes, fileNameRef.current, { skipUnsavedGuard: true })
          } else {
            const resp = await fetch(blankHwpUrl)
            const blankBytes = new Uint8Array(await resp.arrayBuffer())
            if (cancelled) return
            await editor.loadFile(blankBytes, fileNameRef.current || 'blank.hwp', {
              skipUnsavedGuard: true,
            })
          }
          if (cancelled) return

          // Fit the page cleanly to the narrow mobile viewport width after rulers hide.
          await editor.commands.execute('view:zoom-fit-width').catch(() => {})
          if (cancelled) return

          if (!interactiveEditRef.current) {
            syncStudioEditLock(editor, false)
            requestAnimationFrame(() => {
              if (!cancelled && !interactiveEditRef.current) syncStudioEditLock(editor, false)
            })
          }

          frameWindow = editor.element?.contentWindow ?? null
          frameWindow?.addEventListener(STUDIO_DIRTY_EVENT, onFrameDirty)
          dirtyPoll = setInterval(() => {
            if (!interactiveEditRef.current) return
            void editor.commands
              .context()
              .then((ctx) => {
                if (!interactiveEditRef.current) return
                const record = ctx as Record<string, unknown>
                if ((record.isDirty === true || record.modified === true) && !lastReportedDirty) {
                  lastReportedDirty = true
                  onDirtyRef.current()
                }
              })
              .catch(() => {})
          }, DIRTY_POLL_MS)

          setLoading(false)
          onReadyRef.current?.()
        } catch (err) {
          if (!cancelled) {
            setLoading(false)
            onErrorRef.current?.(err instanceof Error ? err.message : String(err))
          }
        }
      })()

      return () => {
        cancelled = true
        disposeReadOnlyGuard?.()
        disposeReadOnlyGuard = null
        disposePinch?.()
        disposePinch = null
        if (dirtyPoll) clearInterval(dirtyPoll)
        frameWindow?.removeEventListener(STUDIO_DIRTY_EVENT, onFrameDirty)
        const current = editorRef.current
        editorRef.current = null
        try {
          current?.destroy()
        } catch {
          // Ignore teardown errors when switching documents quickly.
        }
      }
    }, [documentBytes, lang, theme])

    // Refit page width when rotating between portrait and landscape.
    useEffect(() => {
      if (typeof window === 'undefined') return
      const onOrientation = () => {
        void editorRef.current?.commands.execute('view:zoom-fit-width').catch(() => {})
      }
      window.addEventListener('orientationchange', onOrientation)
      return () => window.removeEventListener('orientationchange', onOrientation)
    }, [])

    useImperativeHandle(
      ref,
      () => ({
        getSavePort(): MobileHwpEditorPort {
          const requireEditor = (): RhwpEditor => {
            const ed = editorRef.current
            if (!ed) throw new Error('HWP editor is not ready.')
            return ed
          }
          return {
            async isPasswordProtected() {
              const ed = requireEditor()
              const ctx = (await ed.commands.context()) as Record<string, unknown>
              const flag = ctx[PASSWORD_FLAG]
              return typeof flag === 'boolean' ? flag : true
            },
            exportHwp: async () => requireEditor().exportHwp(),
            exportHwpx: async () => requireEditor().exportHwpx(),
            exportHwpVerify: async () => requireEditor().exportHwpVerify(),
            async measureTabs() {
              return []
            },
            async getPlainText() {
              const ed = requireEditor()
              const raw = ed as unknown as {
                getText?: () => Promise<string>
              }
              if (typeof raw.getText === 'function') {
                return raw.getText()
              }
              return ''
            },
            async replaceText(find, replace) {
              const ed = requireEditor()
              try {
                await ed.commands.execute('edit:find-replace', { find, replace })
                onDirtyRef.current()
                return true
              } catch {
                return false
              }
            },
            async notifySaved(savedName) {
              const ed = requireEditor()
              await ed.notifySaved(savedName)
            },
          }
        },
        runAction(action) {
          const ed = editorRef.current
          if (!ed) return
          void ed.commands
            .execute(HWP_ACTION_COMMANDS[action])
            .then(() => onDirtyRef.current())
            .catch(() => {})
        },
        fitToWidth() {
          void editorRef.current?.commands.execute('view:zoom-fit-width').catch(() => {})
        },
        async callPlugin(method, ...args) {
          const ed = editorRef.current
          if (!ed) throw new Error('HWP editor is not ready.')
          if (pluginLoadedRef.current?.editor !== ed) {
            const entry = { editor: ed, ready: ed.plugins.load(AGENT_PLUGIN_ID) }
            pluginLoadedRef.current = entry
            // a failed load is tried again by the next call
            entry.ready.catch(() => {
              if (pluginLoadedRef.current === entry) pluginLoadedRef.current = null
            })
          }
          await pluginLoadedRef.current.ready
          return ed.plugins.invoke(AGENT_PLUGIN_ID, method, args)
        },
        async loadBytes(bytes) {
          const ed = editorRef.current
          if (!ed) throw new Error('HWP editor is not ready.')
          await ed.loadFile(bytes, fileNameRef.current || 'document.hwp', {
            skipUnsavedGuard: true,
          })
          await ed.commands.execute('view:zoom-fit-width').catch(() => {})
        },
      }),
      [],
    )

    return (
      <div
        className="mobile-hwp-viewport"
        data-editor="hwp"
        data-renderer="canvas2d"
        data-mode={mode}
      >
        {loading && (
          <div className="mobile-hwp-loading" aria-live="polite">
            <div className="mobile-spinner" aria-hidden="true" />
          </div>
        )}
        <div
          ref={containerRef}
          className="mobile-hwp-frame-host"
          style={{ touchAction: 'pan-x pan-y' }}
          aria-label={fileName}
        />
      </div>
    )
  },
)
