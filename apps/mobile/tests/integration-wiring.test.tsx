// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMobileClient,
  type MobileClient,
  type MobileTransport,
} from '@genoffice/mobile-bridge/transport'
import { redactedMarkdownView } from '@genoffice/mobile-bridge/markdown'
import { isMobileAiBlocked } from '../src/renderer/ai/blocked'
import { HomeAppLayer } from '../src/renderer/home/HomeAppLayer'
import type { HomeHost } from '../src/renderer/home/homeHost'
import { resetKeepScreenOnForTest } from '../src/renderer/home/keepScreenOn'
import { resetHomePrefsForTest } from '../src/renderer/home/prefsStore'
import { usePdfToolsLink } from '../src/renderer/home/pdfToolsLink'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { BackStackProvider } from '../src/renderer/shell/backStack'
import { EditorShell } from '../src/renderer/shell/EditorShell'
// Side-effect import: ToolsTab registers the PDF tools link at module load (B2).
import '../src/renderer/home/ToolsTab'

const cleanups: Array<() => void> = []

function mount(node: React.ReactNode): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root: Root = createRoot(el)
  act(() => root.render(node))
  cleanups.push(() => {
    act(() => root.unmount())
    el.remove()
  })
  return el
}

function fakeClient(): { client: MobileClient; calls: Array<{ command: string; args?: unknown }> } {
  const calls: Array<{ command: string; args?: unknown }> = []
  const transport: MobileTransport = {
    async invoke(command, args) {
      calls.push({ command, args })
      if (command === 'mobile_get_app_prefs') {
        return {
          theme: 'light',
          lang: 'en',
          aiEnabled: false,
          hwpDefaultFormat: 'hwpx',
          keepScreenOnWhileReading: true,
          firstRunDone: true,
        } as never
      }
      if (command === 'mobile_home_app_info') {
        return { version: '0.1.0', platform: 'android', osVersion: '16' } as never
      }
      return { ok: true } as never
    },
    async listen() {
      return () => {}
    },
  }
  return { client: createMobileClient(transport), calls }
}

beforeEach(() => {
  resetKeepScreenOnForTest()
  resetHomePrefsForTest()
})

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

describe('Step 2 cross-track integration wiring', () => {
  it('B2: ToolsTab registers the PDF tools link for T6 home/create/receive entry points', () => {
    let seen: ReturnType<typeof usePdfToolsLink> = null
    function Probe() {
      seen = usePdfToolsLink()
      return null
    }
    mount(<Probe />)
    expect(seen).not.toBeNull()
    expect(typeof seen?.Flow).toBe('function')
  })

  it('B3: markdown hidden-text verification failure is recognized by T7 isMobileAiBlocked', () => {
    let thrown: unknown = null
    try {
      redactedMarkdownView('<span class="redact-span" data-redaction="" data-label="x">secret')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(Error)
    expect(isMobileAiBlocked(thrown)).toBe(true)
    if (isMobileAiBlocked(thrown)) {
      expect(thrown.kind).toBe('hidden-unverified')
    }
  })

  it('F7: EditorShell hides Save As in More sheet when onSaveAs is omitted', () => {
    const onShare = vi.fn()
    const el = mount(
      <MobileLocaleProvider lang="en">
        <BackStackProvider>
          <EditorShell
            docTitle="book.epub"
            docFormat="epub"
            saveState="saved"
            mode="view"
            canEdit={false}
            aiEnabled={false}
            quickActions={[]}
            aiPanelContent={null}
            onBack={() => {}}
            onEnterEdit={() => {}}
            onDone={() => {}}
            onExitEdit={() => {}}
            onSave={() => {}}
            onShare={onShare}
            onFitToWidth={() => {}}
            onOpenBackups={() => {}}
          >
            <div>book</div>
          </EditorShell>
        </BackStackProvider>
      </MobileLocaleProvider>,
    )
    const moreBtn = el.querySelector('[data-testid="editor-more-btn"]') as HTMLButtonElement | null
    expect(moreBtn).not.toBeNull()
    act(() => moreBtn!.click())
    const sheet = document.querySelector('[data-testid="editor-more-sheet"]')
    expect(sheet).not.toBeNull()
    expect(sheet!.textContent).not.toContain('Save As')
    expect(sheet!.textContent).toContain('Share')
  })

  it('F8: HomeAppLayer hides the read-only [Edit a copy] strip when doc.editable is false', () => {
    const { client } = fakeClient()
    const host: HomeHost = {
      client,
      openSession: async () => {},
      createNew: async () => {},
      showToast: () => {},
      refreshHome: async () => {},
      openSettings: () => {},
      openUntitledCopy: async () => {},
    }
    const baseSession = {
      sessionId: 's-1',
      docKey: 'dk-1',
      name: 'damaged.pdf',
      ext: 'pdf',
      format: 'pdf' as const,
      writable: false,
      ephemeral: true,
      uriHint: 'damaged.pdf',
    }
    mount(
      <MobileLocaleProvider lang="en">
        <BackStackProvider>
          <HomeAppLayer
            host={host}
            screen="editor"
            activeDoc={{
              session: baseSession,
              encrypted: false,
              distribution: false,
              isUntitled: false,
              editable: false,
            }}
            mode="view"
          />
        </BackStackProvider>
      </MobileLocaleProvider>,
    )
    expect(document.querySelector('[data-testid="home-readonly-strip"]')).toBeNull()
  })
})
