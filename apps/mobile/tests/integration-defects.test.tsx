// Regression tests for Step 3 integration fixes: B5, B6, B8, F10, F14-2, F15-1, F15-2.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createMobileClient,
  type MobileAiSettingsSnapshot,
  type MobileAppPrefs,
  type MobileChatGptStatus,
  type MobileDocSession,
  type MobileTransport,
} from '@genoffice/mobile-bridge/transport'
import { buildPreviewCopy, mapDocument, PREVIEW_CSP } from '../src/renderer/editors/html/htmlPreview'
import { attachFrameGuards } from '../src/renderer/editors/html/HtmlPreviewFrame'
import { EXPORT_DOCUMENT_URL, SandboxFrameDriver } from '../src/renderer/editors/html/htmlExportDriver'
import { createSheetPasswordPrompt } from '../src/renderer/editors/pdf/view/PdfPasswordSheet'
import { HomeAppLayer } from '../src/renderer/home/HomeAppLayer'
import type { HomeHost } from '../src/renderer/home/homeHost'
import { resetHomeRuntimeForTest } from '../src/renderer/home/homeRuntime'
import { resetIncomingForTest } from '../src/renderer/home/incoming'
import { resetHomePrefsForTest } from '../src/renderer/home/prefsStore'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { SettingsScreen } from '../src/renderer/settings/SettingsScreen'
import { BackStackProvider } from '../src/renderer/shell/backStack'

const roots: Root[] = []
const hosts: HTMLElement[] = []

afterEach(() => {
  while (roots.length > 0) {
    const r = roots.pop()!
    act(() => r.unmount())
  }
  while (hosts.length > 0) hosts.pop()!.remove()
  resetHomeRuntimeForTest()
  resetHomePrefsForTest()
  resetIncomingForTest()
})

function mount(node: React.ReactNode): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  hosts.push(el)
  const root = createRoot(el)
  roots.push(root)
  act(() => root.render(node))
  return el
}

describe('B5 & B6: HTML preview CSP placement and meta refresh neutralisation', () => {
  it('injects CSP at document top rather than inside <svg><head> or <template><head>', () => {
    const svgHtml = '<svg><head></head></svg><iframe src="https://example.com"></iframe>'
    const outSvg = buildPreviewCopy(svgHtml, mapDocument(svgHtml, 1, null))
    const cspIdx = outSvg.indexOf(PREVIEW_CSP)
    const svgIdx = outSvg.indexOf('<svg')
    expect(cspIdx).toBeGreaterThan(-1)
    expect(cspIdx).toBeLessThan(svgIdx)

    const tplHtml = '<template><head></head></template><p>hi</p>'
    const outTpl = buildPreviewCopy(tplHtml, mapDocument(tplHtml, 1, null))
    expect(outTpl.indexOf(PREVIEW_CSP)).toBeGreaterThan(-1)
    expect(outTpl.indexOf(PREVIEW_CSP)).toBeLessThan(outTpl.indexOf('<template'))
  })

  it('neutralises meta refresh even when http-equiv uses HTML numeric character references', () => {
    const dec = '<meta http-equiv="&#114;efresh" content="0;url=https://example.com">'
    const hex = '<meta http-equiv="&#x72;efresh" content="0;url=/">'
    const outDec = buildPreviewCopy(dec, mapDocument(dec, 1, null))
    const outHex = buildPreviewCopy(hex, mapDocument(hex, 1, null))
    expect(outDec).toContain('data-gx-http-equiv="&#114;efresh"')
    expect(outDec).not.toMatch(/\shttp-equiv="&#114;efresh"/i)
    expect(outHex).toContain('data-gx-http-equiv="&#x72;efresh"')
    expect(outHex).not.toMatch(/\shttp-equiv="&#x72;efresh"/i)
  })
})

describe('B8: PDF password prompt integrates with active BackStackProvider', () => {
  it('popstate on the app back stack closes the detached password sheet and resolves null', async () => {
    mount(
      <MobileLocaleProvider lang="ko">
        <BackStackProvider>
          <div />
        </BackStackProvider>
      </MobileLocaleProvider>,
    )

    const prompt = createSheetPasswordPrompt('ko')
    let resolved: string | null | undefined
    const pending = prompt({ fileName: 'secret.pdf', wrong: false }).then((value) => {
      resolved = value
      return value
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(document.querySelector('[data-testid="pdf-password-sheet"]')).not.toBeNull()

    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate'))
      await Promise.resolve()
    })
    expect(await pending).toBeNull()
    expect(resolved).toBeNull()
  })
})

describe('F10: AI results storage card hidden when AI is off and empty', () => {
  function settingsProps(aiEnabled: boolean, results: { bytes: number; files: number }) {
    const transport: MobileTransport = {
      async invoke<T>(command: string): Promise<T> {
        if (command === 'mobile_ai_results_size') return results as T
        return { ok: true } as T
      },
      async listen() {
        return () => {}
      },
    }
    const client = createMobileClient(transport)
    const prefs: MobileAppPrefs = {
      lang: 'ko',
      theme: 'light',
      hwpDefaultFormat: 'hwpx',
      aiEnabled,
    }
    const aiSettings: MobileAiSettingsSnapshot = {
      selectedProvider: 'auto',
      modelByProvider: {},
      configuredProviders: {},
      chatgptVisible: false,
      subscriptionNoticeVersion: 0,
    }
    const chatgptStatus: MobileChatGptStatus = { state: 'hidden' }
    return {
      prefs,
      aiSettings,
      chatgptStatus,
      backups: [],
      onBack: () => {},
      onUpdatePrefs: () => {},
      onSelectProvider: () => {},
      onValidateAndSaveKey: async () => {},
      onRemoveKey: async () => {},
      onChatgptSignIn: async () => {},
      onChatgptSignOut: async () => {},
      onRestoreBackup: async () => {},
      onDeleteBackup: async () => {},
      aiSlot: { client },
    }
  }

  it('hides ai-results-card when AI is off and store is empty', async () => {
    const el = mount(
      <MobileLocaleProvider lang="ko">
        <BackStackProvider>
          <SettingsScreen {...settingsProps(false, { bytes: 0, files: 0 })} />
        </BackStackProvider>
      </MobileLocaleProvider>,
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(el.querySelector('[data-testid="ai-results-card"]')).toBeNull()
  })

  it('shows ai-results-card when AI is off but stored files remain', async () => {
    const el = mount(
      <MobileLocaleProvider lang="ko">
        <BackStackProvider>
          <SettingsScreen {...settingsProps(false, { bytes: 2048, files: 2 })} />
        </BackStackProvider>
      </MobileLocaleProvider>,
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(el.querySelector('[data-testid="ai-results-card"]')).not.toBeNull()
  })
})

describe('F14-2: foreground incoming document event opens without visibility transition', () => {
  it('pulls and opens a queued incoming document when ieum:incoming-document fires', async () => {
    const incoming: MobileDocSession = {
      sessionId: 'inc-1',
      docKey: 'doc-inc-1',
      name: 'shared.md',
      ext: 'md',
      format: 'md',
      writable: false,
      ephemeral: true,
    }
    let queued: MobileDocSession | null = incoming
    const transport: MobileTransport = {
      async invoke<T>(command: string): Promise<T> {
        if (command === 'mobile_consume_pending_open_intent') {
          const next = queued
          queued = null
          return next as T
        }
        if (command === 'mobile_home_take_incoming') return null as T
        if (command === 'mobile_get_app_prefs') {
          return {
            lang: 'ko',
            theme: 'light',
            hwpDefaultFormat: 'hwpx',
            aiEnabled: false,
            firstRunDone: true,
          } as T
        }
        return { ok: true } as T
      },
      async listen() {
        return () => {}
      },
    }
    const openSession = vi.fn(async () => {})
    const host: HomeHost = {
      client: createMobileClient(transport),
      openSession,
      createNew: async () => {},
      showToast: () => {},
      refreshHome: async () => {},
      openSettings: () => {},
    }
    mount(
      <MobileLocaleProvider lang="ko">
        <BackStackProvider>
          <HomeAppLayer host={host} screen="home" activeDoc={null} mode="view" />
        </BackStackProvider>
      </MobileLocaleProvider>,
    )
    await act(async () => {
      window.dispatchEvent(new CustomEvent('ieum:incoming-document'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(openSession).toHaveBeenCalledWith(incoming)
  })
})

describe('F15-1 & F15-2: HTML frame guards and export global shadowing', () => {
  it('blocks SVG xlink:href links, MathML [href], and auxclick', () => {
    const doc = document.implementation.createHTMLDocument('t')
    doc.body.innerHTML =
      '<svg><a xlink:href="https://example.com"><text id="svg-t">x</text></a></svg>' +
      '<math><mtext id="math-t" href="https://example.com">y</mtext></math>'
    const detach = attachFrameGuards(doc)
    try {
      const svgClick = new MouseEvent('click', { bubbles: true, cancelable: true })
      doc.getElementById('svg-t')!.dispatchEvent(svgClick)
      expect(svgClick.defaultPrevented).toBe(true)

      const svgAux = new MouseEvent('auxclick', { bubbles: true, cancelable: true })
      doc.getElementById('svg-t')!.dispatchEvent(svgAux)
      expect(svgAux.defaultPrevented).toBe(true)

      const mathClick = new MouseEvent('click', { bubbles: true, cancelable: true })
      doc.getElementById('math-t')!.dispatchEvent(mathClick)
      expect(mathClick.defaultPrevented).toBe(true)
    } finally {
      detach()
    }
  })

  it('shadows __h2dTrace and __h2dTraceSelector against DOM clobbering', async () => {
    const driver = new SandboxFrameDriver({
      html: '<!DOCTYPE html><html><body><div id="__h2dTrace"></div><div id="__h2dTraceSelector"></div></body></html>',
      missingPictureText: 'missing',
    })
    try {
      await driver.goto(EXPORT_DOCUMENT_URL, { timeoutMs: 200 })
      const win = driver.frameElement?.contentWindow as unknown as Record<string, unknown>
      expect(win.__h2dTrace).toBeUndefined()
      expect(win.__h2dTraceSelector).toBeUndefined()
      const traceType = await driver.evaluate('typeof __h2dTrace')
      expect(traceType).toBe('undefined')
    } finally {
      await driver.close()
    }
  })
})
