import { act, forwardRef, useEffect, useImperativeHandle } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MobileClient, MobileDocSession } from '@genoffice/mobile-bridge/transport'

const mocks = vi.hoisted(() => ({
  studioMounted: 0,
  studioUnmounted: 0,
  flowMounted: 0,
  flowUnmounted: 0,
  releaseRhwpEngine: vi.fn(),
  openFlowDocument: vi.fn(async () => ({
    free: vi.fn(),
    exportHwp: () => new Uint8Array([1, 2, 3]),
    exportHwpx: () => new Uint8Array([1, 2, 3]),
  })),
}))

vi.mock('../src/renderer/editors/rhwpEngine', () => ({
  openFlowDocument: mocks.openFlowDocument,
  releaseRhwpEngine: mocks.releaseRhwpEngine,
}))

vi.mock('../src/renderer/editors/HwpMobileEditor', () => ({
  HwpMobileEditor: forwardRef(function MockHwpMobileEditor(
    { onReady, onDirty }: { onReady?: () => void; onDirty?: () => void },
    ref,
  ) {
    useEffect(() => {
      mocks.studioMounted += 1
      onReady?.()
      return () => {
        mocks.studioUnmounted += 1
      }
    }, [onReady])
    useImperativeHandle(ref, () => ({
      runAction: () => {
        onDirty?.()
      },
      fitToWidth: () => {},
      callPlugin: async () => null,
      getSavePort: () => ({
        isPasswordProtected: async () => false,
        exportHwp: async () => new Uint8Array([1, 2]),
        exportHwpx: async () => new Uint8Array([1, 2]),
        exportHwpVerify: async () => ({ bytes: new Uint8Array([1]), ok: true }),
        measureTabs: async () => [],
        getPlainText: async () => '',
        loadDocumentBytes: async () => {},
      }),
    }))
    return <div data-testid="mock-hwp-studio" />
  }),
}))

vi.mock('../src/renderer/editors/HwpFlowView', () => ({
  HwpFlowView: forwardRef(function MockHwpFlowView(_props: Record<string, unknown>, ref) {
    useEffect(() => {
      mocks.flowMounted += 1
      return () => {
        mocks.flowUnmounted += 1
      }
    }, [])
    useImperativeHandle(ref, () => ({
      runFormat: () => {},
      undo: () => {},
      redo: () => {},
      insertImage: () => true,
      hasPendingEdits: () => false,
      exportBytes: () => null,
      listMemos: () => [],
      addMemo: () => null,
      replyMemo: () => null,
      editMemo: () => null,
      removeMemo: () => null,
      revealMemo: () => false,
      scrollToParagraph: () => false,
    }))
    return <div data-testid="mock-hwp-flow" />
  }),
}))

import { MobileLocaleProvider } from '../src/renderer/i18n'
import { hwpEditorKind } from '../src/renderer/editors/hwpKind'
import { rememberLayout } from '../src/renderer/shell/layoutMemory'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
  window.localStorage.clear()
  mocks.studioMounted = 0
  mocks.studioUnmounted = 0
  mocks.flowMounted = 0
  mocks.flowUnmounted = 0
  mocks.releaseRhwpEngine.mockClear()
  mocks.openFlowDocument.mockClear()
})

describe('hwpEditorKind page-first default, single-WASM studio swap, and close disposal', () => {
  async function mountHwp(docKey: string, windowClass: 'compact' | 'expanded' = 'compact') {
    Object.defineProperty(window, 'innerWidth', {
      value: windowClass === 'compact' ? 390 : 1024,
      configurable: true,
    })
    const session: MobileDocSession = {
      sessionId: `sess-${docKey}`,
      docKey,
      name: 'sample.hwpx',
      ext: 'hwpx',
      format: 'hwpx',
      writable: true,
      ephemeral: false,
    }
    const client = {
      readFileBytes: vi.fn(async () => ({ bytesBase64: btoa('PK\x03\x04') })),
    } as unknown as MobileClient

    const opened = await hwpEditorKind.open({
      session,
      client,
      isUntitled: false,
    })

    const doc = opened.start({
      client,
      markDirty: () => {},
      updateSession: () => {},
      setNotice: () => {},
      showToast: () => {},
      contentChanged: () => {},
      refreshHome: async () => {},
      openSession: async () => {},
      translate: (key) => key,
      windowClass: () => windowClass,
    })

    const el = document.createElement('div')
    document.body.appendChild(el)
    const root: Root = createRoot(el)
    cleanups.push(() => {
      act(() => root.unmount())
      el.remove()
    })

    const Workspace = doc.Workspace
    act(() => {
      root.render(
        <MobileLocaleProvider lang="ko">
          <Workspace
            frame={{
              docTitle: 'sample.hwpx',
              docFormat: 'hwpx',
              saveState: 'saved',
              mode: 'view',
              canEdit: true,
              aiEnabled: false,
              aiPanelContent: null,
              onBack: () => {},
              onEnterEdit: () => {},
              onDone: () => {},
              onExitEdit: () => {},
              onSave: () => {},
              onSaveAs: () => {},
              onShare: () => {},
              onOpenBackups: () => {},
            }}
            mode="view"
            canEdit
            lang="ko"
            theme="light"
          />
        </MobileLocaleProvider>,
      )
    })

    return { doc, el }
  }

  it('opens in page view by default on phone, swaps single-WASM on page/flow toggle, and releases on dispose', async () => {
    const { doc, el } = await mountHwp('doc-hwp-mem-1', 'compact')

    // Phone opens in page view by default without spinning up a flow WASM instance.
    expect(mocks.studioMounted).toBe(1)
    expect(mocks.flowMounted).toBe(0)
    expect(el.querySelector('[data-testid="mock-hwp-studio"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="mock-hwp-flow"]')).toBeNull()

    // Page view shows a labeled Reading view button; switching unmounts studio so only one WASM lives.
    const flowBtn = el.querySelector<HTMLButtonElement>('[data-testid="view-tool-flowView"]')
    expect(flowBtn).not.toBeNull()
    expect(flowBtn!.textContent).toContain('읽기 화면')
    await act(async () => {
      flowBtn!.click()
      await Promise.resolve()
    })
    expect(mocks.studioUnmounted).toBe(1)
    expect(mocks.flowMounted).toBe(1)
    expect(el.querySelector('[data-testid="mock-hwp-studio"]')).toBeNull()
    expect(el.querySelector('[data-testid="mock-hwp-flow"]')).not.toBeNull()

    // Reading view shows a labeled Page view button; returning mounts studio and releases flow WASM.
    const callsBeforePageSwitch = mocks.releaseRhwpEngine.mock.calls.length
    const pageBtn = el.querySelector<HTMLButtonElement>('[data-testid="view-tool-pageView"]')
    expect(pageBtn).not.toBeNull()
    expect(pageBtn!.textContent).toContain('쪽 화면')
    await act(async () => {
      pageBtn!.click()
      await Promise.resolve()
    })
    expect(mocks.studioMounted).toBe(2)
    expect(mocks.flowUnmounted).toBe(1)
    expect(mocks.releaseRhwpEngine.mock.calls.length).toBe(callsBeforePageSwitch + 1)

    // Closing the document disposes buffers and releases the flow WASM host.
    const callsBeforeDispose = mocks.releaseRhwpEngine.mock.calls.length
    act(() => {
      doc.dispose?.()
    })
    expect(mocks.releaseRhwpEngine.mock.calls.length).toBe(callsBeforeDispose + 1)
  })

  it('honors a per-document remembered reading view without mounting studio upfront', async () => {
    rememberLayout(window.localStorage, 'doc-hwp-remembered-flow', 'flow')
    const { doc, el } = await mountHwp('doc-hwp-remembered-flow', 'compact')

    expect(mocks.flowMounted).toBe(1)
    expect(mocks.studioMounted).toBe(0)
    expect(el.querySelector('[data-testid="mock-hwp-flow"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="mock-hwp-studio"]')).toBeNull()

    act(() => {
      doc.dispose?.()
    })
  })

  it('opens in page view on tablet with a labeled reading view button in the header', async () => {
    const { doc, el } = await mountHwp('doc-hwp-tablet-default', 'expanded')

    expect(mocks.studioMounted).toBe(1)
    expect(mocks.flowMounted).toBe(0)
    const flowBtn = el.querySelector<HTMLButtonElement>(
      '[data-testid="editor-header"] [data-testid="view-tool-flowView"]',
    )
    expect(flowBtn).not.toBeNull()
    expect(flowBtn!.textContent).toContain('읽기 화면')

    act(() => {
      doc.dispose?.()
    })
  })
})
