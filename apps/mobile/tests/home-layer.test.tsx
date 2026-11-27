// HOME-T10: the T6 app layer inside the whole app (spec 3.8–3.10, 3.12–3.14, 4).
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMobileClient,
  type MobileAiSettingsSnapshot,
  type MobileAppPrefs,
  type MobileChatGptStatus,
  type MobileDocSession,
  type MobileTransport,
} from '@genoffice/mobile-bridge/transport'
import { MobileApp } from '../src/renderer/App'
import { resetHomeRuntimeForTest } from '../src/renderer/home/homeRuntime'
import { resetIncomingForTest } from '../src/renderer/home/incoming'
import { tipAnchor } from '../src/renderer/home/layer/tipModel'
import {
  providePdfToolsLink,
  type PdfToolFlowProps,
  type PdfToolsLink,
} from '../src/renderer/home/pdfToolsLink'
import { resetHomePrefsForTest } from '../src/renderer/home/prefsStore'
import { translateMobile } from '../src/renderer/i18n'

// The same two-kind registry the open-gate test pins, so other tracks' kinds do not change these
// flows.
vi.mock('../src/renderer/editors/registry', async () => {
  const { hwpEditorKind } = await import('../src/renderer/editors/hwpKind')
  const { markdownEditorKind } = await import('../src/renderer/editors/markdownKind')
  const kinds = [hwpEditorKind, markdownEditorKind]
  return {
    EDITOR_KINDS: kinds,
    findEditorKind: (format: string) =>
      kinds.find((kind) => (kind.formats as readonly string[]).includes(format)) ?? null,
    openableExtensions: () => kinds.flatMap((kind) => kind.openExtensions),
  }
})

type Call = { command: string; args?: Record<string, unknown> }

interface MockOptions {
  readonly prefs?: Partial<MobileAppPrefs>
  readonly pendingIntent?: MobileDocSession | null
  readonly batch?: unknown
  readonly appInfo?: unknown
  readonly linkFolder?: () => unknown
  readonly incomingSessions?: Record<string, MobileDocSession>
}

function makeMockTransport(options: MockOptions = {}): {
  transport: MobileTransport
  calls: Call[]
} {
  const calls: Call[] = []
  let prefs: MobileAppPrefs = {
    lang: 'ko',
    theme: 'system',
    hwpDefaultFormat: 'hwp',
    aiEnabled: false,
    ...options.prefs,
  }
  const aiSettings: MobileAiSettingsSnapshot = {
    selectedProvider: 'auto',
    modelByProvider: {},
    configuredProviders: {},
    chatgptVisible: false,
    subscriptionNoticeVersion: 0,
  }
  const chatgptStatus: MobileChatGptStatus = { state: 'hidden' }
  let pendingIntent = options.pendingIntent ?? null
  let batch = options.batch ?? null

  const transport: MobileTransport = {
    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      calls.push({ command, args })
      switch (command) {
        case 'mobile_get_app_prefs':
          return prefs as T
        case 'mobile_set_app_prefs':
          prefs = { ...prefs, ...(args as Partial<MobileAppPrefs>) }
          return prefs as T
        case 'mobile_get_ai_settings':
        case 'mobile_set_ai_settings':
          return aiSettings as T
        case 'mobile_chatgpt_status':
          return chatgptStatus as T
        case 'mobile_list_recent_docs':
        case 'mobile_recovery_list':
        case 'mobile_hwp_backup_list':
          return [] as T
        case 'mobile_consume_pending_open_intent': {
          const next = pendingIntent
          pendingIntent = null
          return next as T
        }
        case 'mobile_home_take_incoming': {
          const next = batch
          batch = null
          return next as T
        }
        case 'mobile_home_open_incoming_entry': {
          const session = options.incomingSessions?.[String(args?.entryId)]
          if (!session) throw { code: 'INVALID_ARGUMENT', messageKey: 'mobile.format.notOpenable' }
          return session as T
        }
        case 'mobile_home_app_info':
          return (options.appInfo ?? { ok: true }) as T
        case 'mobile_home_link_folder':
          if (!options.linkFolder) throw { code: 'USER_CANCELLED', messageKey: 'cancelled' }
          return options.linkFolder() as T
        case 'mobile_create_untitled_session':
          return {
            sessionId: 'untitled-1',
            docKey: 'untitled-abc',
            name: 'Untitled.md',
            ext: 'md',
            format: 'md',
            writable: false,
            ephemeral: false,
          } as T
        case 'mobile_read_file_bytes':
          return {
            bytesBase64: Buffer.from('# Shared\nBody.', 'utf8').toString('base64'),
          } as T
        default:
          return { ok: true } as T
      }
    },
    async listen() {
      return () => {}
    },
  }
  return { transport, calls }
}

const roots: Root[] = []
const containers: HTMLElement[] = []

function resetPdfToolsLink() {
  // the link has no "remove"; tests put back the state before T3 provides it
  providePdfToolsLink(null as unknown as PdfToolsLink)
}

beforeEach(() => {
  resetHomePrefsForTest()
  resetHomeRuntimeForTest()
  resetIncomingForTest()
  resetPdfToolsLink()
})

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  for (const container of containers.splice(0)) container.remove()
  resetPdfToolsLink()
})

async function wait(ms = 120) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

async function renderApp(options?: MockOptions) {
  const { transport, calls } = makeMockTransport(options)
  const client = createMobileClient(transport)
  const div = document.createElement('div')
  document.body.appendChild(div)
  containers.push(div)
  const root = createRoot(div)
  roots.push(root)
  await act(async () => {
    root.render(<MobileApp client={client} />)
  })
  await wait()
  return { div, calls }
}

async function click(el: Element | null) {
  expect(el).not.toBeNull()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await wait()
}

function q(div: ParentNode, testId: string): HTMLElement | null {
  return div.querySelector(`[data-testid="${testId}"]`)
}

function prefWrites(calls: Call[], key: string): unknown[] {
  return calls
    .filter((call) => call.command === 'mobile_set_app_prefs' && call.args && key in call.args)
    .map((call) => call.args?.[key])
}

const MD_DOC: MobileDocSession = {
  sessionId: 'doc-1',
  docKey: 'key-doc-1',
  name: 'notes.md',
  ext: 'md',
  format: 'md',
  writable: true,
  ephemeral: false,
  uriHint: 'content://notes.md',
}

const SHARED_DOC: MobileDocSession = {
  sessionId: 'ext-1',
  docKey: 'untitled-share-1',
  name: 'shared.md',
  ext: 'md',
  format: 'md',
  writable: false,
  ephemeral: true,
}

describe('asking before a file opens in an editor that is off', () => {
  it('[Turn on and open] saves the editor on and opens the file', async () => {
    const { div, calls } = await renderApp({
      prefs: { editorsOff: ['markdown'] },
      pendingIntent: MD_DOC,
    })
    const dialog = q(div, 'home-run-editor-off')
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain('마크다운 편집기가 꺼져 있어요')
    expect(div.querySelector('[data-editor="markdown"]')).toBeNull()

    await click(q(div, 'home-run-editor-off-ok'))
    expect(prefWrites(calls, 'editorsOff')).toEqual([[]])
    expect(q(div, 'home-run-editor-off')).toBeNull()
    expect(div.querySelector('[data-editor="markdown"]')).not.toBeNull()
  })

  it('[Cancel] leaves the file closed and the editor off', async () => {
    const { div, calls } = await renderApp({
      prefs: { editorsOff: ['markdown'] },
      pendingIntent: MD_DOC,
    })
    await click(q(div, 'home-run-editor-off-cancel'))
    expect(q(div, 'home-run-editor-off')).toBeNull()
    expect(div.querySelector('[data-editor="markdown"]')).toBeNull()
    expect(q(div, 'mobile-home-screen')).not.toBeNull()
    expect(prefWrites(calls, 'editorsOff')).toEqual([])
  })
})

describe('the read-only strip', () => {
  it('marks a received file and [Edit a copy] opens an untitled copy in edit mode', async () => {
    const { div, calls } = await renderApp({ pendingIntent: SHARED_DOC })
    expect(div.querySelector('[data-editor="markdown"]')?.getAttribute('data-mode')).toBe('view')
    const strip = q(div, 'home-run-readonly-strip')
    expect(strip?.textContent).toContain('받은 파일 · 읽기 전용')
    expect(strip?.textContent).toContain('사본으로 편집')

    await click(q(div, 'home-run-strip-copy'))
    expect(
      calls.some((c) => c.command === 'mobile_read_file_bytes' && c.args?.sessionId === 'ext-1'),
    ).toBe(true)
    expect(
      calls.some((c) => c.command === 'mobile_create_untitled_session' && c.args?.format === 'md'),
    ).toBe(true)
    expect(div.querySelector('[data-editor="markdown"]')?.getAttribute('data-mode')).toBe('edit')
    expect(q(div, 'editor-header')?.textContent).toContain('shared.md')
    expect(q(div, 'editor-save-btn')?.getAttribute('data-state')).toBe('dirty')
    expect(q(div, 'home-run-readonly-strip')).toBeNull()
  })

  it('stays away once closed, and from documents that can be written', async () => {
    const shared = await renderApp({ pendingIntent: SHARED_DOC })
    await click(q(shared.div, 'home-run-strip-close'))
    expect(q(shared.div, 'home-run-readonly-strip')).toBeNull()

    const writable = await renderApp({ pendingIntent: MD_DOC })
    expect(writable.div.querySelector('[data-editor="markdown"]')).not.toBeNull()
    expect(q(writable.div, 'home-run-readonly-strip')).toBeNull()
  })
})

const PICTURES = {
  id: 'batch-1',
  entries: [
    { id: 'p1', name: 'one.jpg', mime: 'image/jpeg', isPicture: true, sizeBytes: 10 },
    { id: 'p2', name: 'two.png', mime: 'image/png', isPicture: true, sizeBytes: 20 },
  ],
}

function fakeLink(seen: PdfToolFlowProps[]): PdfToolsLink {
  return {
    Flow: (props: PdfToolFlowProps) => {
      seen.push(props)
      return <div data-testid="fake-tool-flow">{props.start.kind}</div>
    },
  }
}

describe('the receive screen', () => {
  it('lists a received batch and offers [Make PDF] only once T3 has linked its tools', async () => {
    const { div } = await renderApp({ batch: PICTURES })
    const screen = q(div, 'home-run-receive')
    expect(screen).not.toBeNull()
    expect(screen?.textContent).toContain('one.jpg')
    expect(screen?.textContent).toContain('two.png')
    expect(q(div, 'home-run-receive-imagesToPdf')).toBeNull()
    expect(q(div, 'home-run-receive-not-openable')?.textContent).toContain('열 수 없습니다')

    const seen: PdfToolFlowProps[] = []
    await act(async () => providePdfToolsLink(fakeLink(seen)))
    await wait()
    await click(q(div, 'home-run-receive-imagesToPdf'))
    expect(q(div, 'fake-tool-flow')?.textContent).toBe('imagesToPdf')
    const start = seen[seen.length - 1]?.start
    expect(start?.kind === 'imagesToPdf' ? start.inputs.map((i) => i.name) : []).toEqual([
      'one.jpg',
      'two.png',
    ])
  })

  it('with PDF tools off says so and [Turn on and continue] brings the button', async () => {
    providePdfToolsLink(fakeLink([]))
    const { div, calls } = await renderApp({
      prefs: { editorsOff: ['pdfTools'] },
      batch: PICTURES,
    })
    expect(q(div, 'home-run-receive-imagesToPdf')).toBeNull()
    expect(q(div, 'home-run-receive-off')?.textContent).toContain('PDF 도구가 꺼져 있어요')
    await click(q(div, 'home-run-receive-pdf-on'))
    expect(prefWrites(calls, 'editorsOff')).toEqual([[]])
    expect(q(div, 'home-run-receive-off')).toBeNull()
    expect(q(div, 'home-run-receive-imagesToPdf')).not.toBeNull()
  })

  it('opens a document of a mixed batch with [Open] and closes the screen', async () => {
    providePdfToolsLink(fakeLink([]))
    const { div, calls } = await renderApp({
      batch: {
        id: 'batch-2',
        entries: [
          { id: 'f1', name: 'paper.pdf', mime: 'application/pdf', format: 'pdf', isPicture: false },
          { id: 'f2', name: 'memo.md', mime: 'text/markdown', format: 'md', isPicture: false },
        ],
      },
      incomingSessions: { f2: { ...SHARED_DOC, sessionId: 'in-2', name: 'memo.md' } },
    })
    expect(q(div, 'home-run-receive-merge')).toBeNull()
    expect(q(div, 'home-run-receive-open-incoming:batch-2:f1')).toBeNull()
    await click(q(div, 'home-run-receive-open-incoming:batch-2:f2'))
    expect(
      calls.some(
        (c) =>
          c.command === 'mobile_home_open_incoming_entry' &&
          c.args?.batchId === 'batch-2' &&
          c.args?.entryId === 'f2',
      ),
    ).toBe(true)
    expect(q(div, 'home-run-receive')).toBeNull()
    expect(div.querySelector('[data-editor="markdown"]')).not.toBeNull()
    expect(q(div, 'home-run-readonly-strip')?.textContent).toContain('받은 파일')
  })
})

describe('the first-run guide', () => {
  it('waits for a receive screen opened at start-up and shows once it closes', async () => {
    const { div } = await renderApp({ prefs: { firstRunDone: false }, batch: PICTURES })
    expect(q(div, 'home-run-receive')).not.toBeNull()
    expect(q(div, 'home-run-first')).toBeNull()
    await click(q(div, 'home-run-receive-close'))
    expect(q(div, 'home-run-receive')).toBeNull()
    expect(q(div, 'home-run-first')).not.toBeNull()
  })

  it('lets a document received at start-up open first and shows on the next home', async () => {
    const { div } = await renderApp({ prefs: { firstRunDone: false }, pendingIntent: SHARED_DOC })
    expect(q(div, 'editor-header')).not.toBeNull()
    expect(q(div, 'home-run-first')).toBeNull()
    await click(q(div, 'editor-back-btn'))
    expect(q(div, 'mobile-home-screen')).not.toBeNull()
    expect(q(div, 'home-run-first')).not.toBeNull()
  })

  it('does not show when the settings have no such field', async () => {
    const { div } = await renderApp()
    expect(q(div, 'mobile-home-screen')).not.toBeNull()
    expect(q(div, 'home-run-first')).toBeNull()
  })

  it('shows a single welcome screen over the home with no folder-picker step, and [Get started] records it', async () => {
    const { div, calls } = await renderApp({ prefs: { firstRunDone: false } })
    const overlay = q(div, 'home-run-first')
    expect(overlay).not.toBeNull()
    expect(overlay?.getAttribute('data-step')).toBe('welcome')
    expect(q(div, 'mobile-home-screen')).not.toBeNull()
    expect(overlay?.textContent).toContain('반가워요')
    // Folder linking moved to the home [Folders] tab: no step 2 or folder picker in first run.
    expect(q(div, 'home-run-first-next')).toBeNull()
    expect(q(div, 'home-run-first-pick')).toBeNull()
    expect(q(div, 'home-run-first-later')).toBeNull()
    expect(q(div, 'home-run-first-skip')).toBeNull()

    await click(q(div, 'home-run-first-start'))
    expect(prefWrites(calls, 'firstRunDone')).toEqual([true])
    expect(calls.some((c) => c.command === 'mobile_home_link_folder')).toBe(false)
    expect(q(div, 'home-run-first')).toBeNull()
  })
})

describe("what's new", () => {
  const appInfo = { version: '0.1.0', platform: 'android', osVersion: '14' }

  it('writes the version silently on a fresh install', async () => {
    const { div, calls } = await renderApp({
      prefs: { firstRunDone: true, lastSeenVersion: '' },
      appInfo,
    })
    expect(prefWrites(calls, 'lastSeenVersion')).toEqual(['0.1.0'])
    expect(q(div, 'home-help-whats-new-sheet')).toBeNull()
  })

  it('shows the sheet once after an update', async () => {
    const { div, calls } = await renderApp({
      prefs: { firstRunDone: true, lastSeenVersion: '0.0.9' },
      appInfo,
    })
    expect(q(div, 'home-help-whats-new-sheet')).not.toBeNull()
    expect(prefWrites(calls, 'lastSeenVersion')).toEqual(['0.1.0'])
    await click(
      q(div, 'home-help-whats-new-sheet')?.querySelector('.mobile-sheet-header button') ?? null,
    )
    expect(q(div, 'home-help-whats-new-sheet')).toBeNull()
    await wait()
    expect(q(div, 'home-help-whats-new-sheet')).toBeNull()
    expect(prefWrites(calls, 'lastSeenVersion')).toEqual(['0.1.0'])
  })

  it('stays quiet when the field is missing', async () => {
    const { div, calls } = await renderApp({ prefs: { firstRunDone: true }, appInfo })
    expect(q(div, 'home-help-whats-new-sheet')).toBeNull()
    expect(prefWrites(calls, 'lastSeenVersion')).toEqual([])
  })
})

describe('first-use tips', () => {
  async function pointerDown() {
    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    await wait()
  }

  it('shows the [Edit] tip once, records it, then the first-edit tip by the save state', async () => {
    const { div, calls } = await renderApp({ prefs: { tipsSeen: [] }, pendingIntent: MD_DOC })
    const tip = q(document.body, 'home-run-tip')
    expect(tip?.getAttribute('data-tip')).toBe('editButton')
    expect(q(div, 'home-run-tip-live')?.textContent).toBe('고치려면 [편집]을 누르세요')

    await pointerDown()
    expect(q(document.body, 'home-run-tip')).toBeNull()
    expect(prefWrites(calls, 'tipsSeen')).toEqual([['editButton']])
    await wait()
    expect(q(document.body, 'home-run-tip')).toBeNull()

    await click(q(div, 'editor-mode-toggle'))
    expect(q(document.body, 'home-run-tip')?.getAttribute('data-tip')).toBe('firstEdit')
  })

  it('shows nothing when the settings have no tips field', async () => {
    await renderApp({ pendingIntent: MD_DOC })
    expect(q(document.body, 'home-run-tip')).toBeNull()
  })

  it('points the flow-view tip at the "page view" view tool, else at the flow view', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div data-testid="hwp-flow-view"></div>'
    document.body.appendChild(root)
    containers.push(root)
    const context = { mode: 'view' as const, pageViewLabel: translateMobile('ko', 'pageView') }
    expect(tipAnchor('flowView', context, root)?.getAttribute('data-testid')).toBe('hwp-flow-view')
    const button = document.createElement('button')
    button.setAttribute('aria-label', translateMobile('ko', 'pageView'))
    root.appendChild(button)
    expect(tipAnchor('flowView', context, root)).toBe(button)
  })
})
