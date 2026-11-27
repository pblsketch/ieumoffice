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
    { onReady }: { onReady?: () => void },
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
      runAction: () => {},
      fitToWidth: () => {},
      callPlugin: async () => null,
      getSavePort: () => ({
        isPasswordProtected: async () => false,
        exportHwp: async () => new Uint8Array([1]),
        exportHwpx: async () => new Uint8Array([1]),
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

describe('hwpEditorKind single-WASM lazy studio and close disposal', () => {
  it('defers studio mount in phone flow view, swaps on page/flow toggle, and releases WASM on dispose', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
    const session: MobileDocSession = {
      sessionId: 'sess-1',
      docKey: 'doc-hwp-mem-1',
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
      windowClass: () => 'compact',
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

    // Phone opens in flow view without spinning up a hidden studio iframe.
    expect(mocks.flowMounted).toBe(1)
    expect(mocks.studioMounted).toBe(0)
    expect(el.querySelector('[data-testid="mock-hwp-flow"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="mock-hwp-studio"]')).toBeNull()

    // Switching to page view lazily mounts studio and releases the flow WASM engine.
    const pageBtn = el.querySelector<HTMLButtonElement>('[data-testid="view-tool-pageView"]')
    expect(pageBtn).not.toBeNull()
    await act(async () => {
      pageBtn!.click()
      await Promise.resolve()
    })
    expect(mocks.studioMounted).toBe(1)
    expect(mocks.flowUnmounted).toBe(1)
    expect(mocks.releaseRhwpEngine).toHaveBeenCalledTimes(1)

    // Returning to flow view without studio edits unmounts studio so only one WASM lives.
    const flowBtn = el.querySelector<HTMLButtonElement>('[data-testid="view-tool-flowView"]')
    expect(flowBtn).not.toBeNull()
    await act(async () => {
      flowBtn!.click()
      await Promise.resolve()
    })
    expect(mocks.studioUnmounted).toBe(1)
    expect(mocks.flowMounted).toBe(2)

    // Closing the document disposes buffers and releases the flow WASM host.
    const callsBeforeDispose = mocks.releaseRhwpEngine.mock.calls.length
    act(() => {
      doc.dispose?.()
    })
    expect(mocks.releaseRhwpEngine.mock.calls.length).toBe(callsBeforeDispose + 1)
  })
})
