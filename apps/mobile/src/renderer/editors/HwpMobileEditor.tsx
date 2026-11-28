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

export type HwpQuickAction = 'undo' | 'redo' | 'bold' | 'italic' | 'underline'

export interface HwpMobileEditorHandle {
  readonly getSavePort: () => MobileHwpEditorPort
  readonly runAction: (action: HwpQuickAction) => void
  readonly fitToWidth: () => void
}

export interface HwpMobileEditorProps {
  readonly fileName: string
  readonly documentBytes: Uint8Array | null
  readonly mode: DocumentMode
  readonly lang: Lang
  readonly theme: MobileTheme
  readonly onDirty: () => void
  readonly onReady?: () => void
  readonly onError?: (message: string) => void
}

/** Matches `PASSWORD_FLAG` in `apps/hwp/scripts/rhwp-patches.mjs`. */
const PASSWORD_FLAG = 'passwordProtected'
const STUDIO_DIRTY_EVENT = 'ieum:dirty'
const DIRTY_POLL_MS = 2000

const MOBILE_HIDDEN_CHROME = {
  menu: false,
  toolbar: false,
  statusbar: false,
} as const

/**
 * Strips desktop centimeter rulers inside the same-origin rhwp-studio iframe on
 * narrow phone viewports so the Hangul page uses the full width cleanly.
 */
function applyMobileStudioCanvasStyle(editor: RhwpEditor): void {
  try {
    const doc = editor.element?.contentDocument
    if (!doc?.head) return
    const existing = doc.getElementById('ieum-mobile-studio-style')
    if (existing) return
    const style = doc.createElement('style')
    style.id = 'ieum-mobile-studio-style'
    style.textContent = `
      @media (max-width: 767px) {
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

export const HwpMobileEditor = forwardRef<HwpMobileEditorHandle, HwpMobileEditorProps>(
  function HwpMobileEditor(
    { fileName, documentBytes, mode, lang, theme, onDirty, onReady, onError },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const editorRef = useRef<RhwpEditor | null>(null)
    const [loading, setLoading] = useState(true)
    const [zoom, setZoom] = useState(1)

    // Keep callback props in refs so parent re-renders never tear down and reload rhwp-studio.
    const onDirtyRef = useRef(onDirty)
    onDirtyRef.current = onDirty
    const onReadyRef = useRef(onReady)
    onReadyRef.current = onReady
    const onErrorRef = useRef(onError)
    onErrorRef.current = onError

    useEffect(() => {
      let cancelled = false
      let dirtyPoll: ReturnType<typeof setInterval> | null = null
      let frameWindow: Window | null = null
      let lastReportedDirty = false
      const container = containerRef.current
      if (!container) return
      setLoading(true)

      const onFrameDirty = (event: Event) => {
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
          if (cancelled) return

          if (documentBytes && documentBytes.byteLength > 0) {
            await editor.loadFile(documentBytes, fileName, { skipUnsavedGuard: true })
          } else {
            const resp = await fetch(blankHwpUrl)
            const blankBytes = new Uint8Array(await resp.arrayBuffer())
            if (cancelled) return
            await editor.loadFile(blankBytes, fileName || 'blank.hwp', { skipUnsavedGuard: true })
          }
          if (cancelled) return

          // Fit the page cleanly to the narrow mobile viewport width after rulers hide.
          await editor.commands.execute('view:zoom-fit-width').catch(() => {})
          if (cancelled) return

          frameWindow = editor.element?.contentWindow ?? null
          frameWindow?.addEventListener(STUDIO_DIRTY_EVENT, onFrameDirty)
          dirtyPoll = setInterval(() => {
            void editor.commands
              .context()
              .then((ctx) => {
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
    }, [documentBytes, fileName, lang, theme])

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
            exportHwp: () => requireEditor().exportHwp(),
            exportHwpx: () => requireEditor().exportHwpx(),
            exportHwpVerify: () => requireEditor().exportHwpVerify(),
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
          const map: Record<HwpQuickAction, string> = {
            undo: 'edit:undo',
            redo: 'edit:redo',
            bold: 'format:bold',
            italic: 'format:italic',
            underline: 'format:underline',
          }
          void ed.commands
            .execute(map[action])
            .then(() => onDirtyRef.current())
            .catch(() => {})
        },
        fitToWidth() {
          setZoom(1)
          void editorRef.current?.commands.execute('view:zoom-fit-width').catch(() => {})
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
          style={{
            transform: zoom === 1 ? undefined : `scale(${zoom})`,
            transformOrigin: 'top left',
            touchAction: 'pan-x pan-y pinch-zoom',
          }}
          aria-label={fileName}
        />
      </div>
    )
  },
)
