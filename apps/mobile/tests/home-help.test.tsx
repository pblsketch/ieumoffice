import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import type { MobileAppPrefsPatch, MobileClient } from '@genoffice/mobile-bridge/transport'
import {
  FEEDBACK_STRINGS,
  FEEDBACK_SURVEY_URL as PC_SURVEY_URL,
} from '../../shell/src/main/feedback'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { homeStrings } from '../src/renderer/i18n/home'
import { ko as koHelp } from '../src/renderer/i18n/home/help/ko'
import { HELP_ARTICLES } from '../src/renderer/home/help/articles'
import { FEEDBACK_SURVEY_URL, feedbackOsLabel } from '../src/renderer/home/help/feedback'
import {
  compareVersions,
  latestWhatsNewEntry,
  markWhatsNewSeen,
  MOBILE_FIRST_VERSION,
  WHATS_NEW_ENTRIES,
  whatsNewToShow,
  type WhatsNewEntry,
} from '../src/renderer/home/help/whatsNew'
import type { HomeHost } from '../src/renderer/home/homeHost'
import { resetHomeRuntimeForTest, setHomeRuntime } from '../src/renderer/home/homeRuntime'
import { getHomePrefs, resetHomePrefsForTest } from '../src/renderer/home/prefsStore'
import { HelpSection } from '../src/renderer/settings/sections/HelpSection'

const here = dirname(fileURLToPath(import.meta.url))
const OPEN_URL = 'mobile_home_open_external_url'
const APP_INFO = 'mobile_home_app_info'

function entry(version: string): WhatsNewEntry {
  return { version, itemKeys: ['homeHelpNew010First'] }
}

const versions = (list: readonly WhatsNewEntry[]) => list.map((item) => item.version)

describe('whatsNewToShow', () => {
  const entries = [entry('0.1.0'), entry('0.2.0'), entry('0.3.0'), entry('0.4.0')]

  it.each([
    ['fresh install', '', '0.3.0', []],
    ['missing field', null, '0.3.0', []],
    ['same version', '0.3.0', '0.3.0', []],
    ['older app than remembered', '0.4.0', '0.3.0', []],
    ['upgrade by one', '0.2.0', '0.3.0', ['0.3.0']],
    ['upgrade over two', '0.1.0', '0.3.0', ['0.3.0', '0.2.0']],
    ['upgrade with no entry in between', '0.4.0', '0.4.5', []],
    ['unparsable remembered version', 'garbage', '0.3.0', []],
    ['unparsable current version', '0.1.0', 'dev', []],
  ] as const)('%s', (_name, lastSeen, current, expected) => {
    expect(versions(whatsNewToShow(lastSeen, current, entries))).toEqual(expected)
  })

  it('compares the numbers, not the text, and lists newest first whatever the input order', () => {
    const list = [entry('0.10.0'), entry('0.9.1'), entry('0.9.0')]
    expect(versions(whatsNewToShow('0.9.0', '0.10.0', list))).toEqual(['0.10.0', '0.9.1'])
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1)
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1)
    expect(compareVersions('x', '1.0.0')).toBeNull()
    expect(versions(whatsNewToShow('1.0.0-beta.1', '1.0.0', [entry('1.0.0')]))).toEqual(['1.0.0'])
  })

  it('has the 1st release entry at the app version, which never shows as an update', () => {
    const conf = JSON.parse(
      readFileSync(join(here, '..', 'src-tauri', 'tauri.conf.json'), 'utf8'),
    ) as { version: string }
    expect(MOBILE_FIRST_VERSION).toBe(conf.version)
    expect(WHATS_NEW_ENTRIES.map((item) => item.version)).toContain(conf.version)
    expect(whatsNewToShow('', conf.version, WHATS_NEW_ENTRIES)).toEqual([])
    expect(whatsNewToShow(null, conf.version, WHATS_NEW_ENTRIES)).toEqual([])
    expect(latestWhatsNewEntry(conf.version, WHATS_NEW_ENTRIES)?.version).toBe(conf.version)
  })

  it('Help picks the latest entry not newer than the app', () => {
    const list = [entry('0.1.0'), entry('0.3.0'), entry('0.2.0')]
    expect(latestWhatsNewEntry('0.2.5', list)?.version).toBe('0.2.0')
    expect(latestWhatsNewEntry('0.0.1', list)).toBeNull()
    expect(latestWhatsNewEntry(null, list)?.version).toBe('0.3.0')
  })
})

interface FakeClient {
  readonly client: MobileClient
  readonly invoke: ReturnType<typeof vi.fn>
  readonly setAppPrefs: ReturnType<typeof vi.fn>
}

function fakeClient(options: { appInfo?: unknown; failSave?: boolean } = {}): FakeClient {
  let stored: Record<string, unknown> = { firstRunDone: true, lastSeenVersion: '' }
  const invoke = vi.fn(async (command: string) => {
    if (command === APP_INFO) {
      return options.appInfo ?? { version: '0.1.0', platform: 'android', osVersion: '15' }
    }
    return { ok: true }
  })
  const setAppPrefs = vi.fn(async (patch: MobileAppPrefsPatch) => {
    if (options.failSave) throw new Error('disk full')
    stored = { ...stored, ...patch }
    return { ...stored }
  })
  const getAppPrefs = vi.fn(async () => ({ ...stored }))
  const client = { transport: { invoke }, getAppPrefs, setAppPrefs } as unknown as MobileClient
  return { client, invoke, setAppPrefs }
}

function hostFor(client: MobileClient, showToast = vi.fn()): HomeHost {
  return {
    client,
    openSession: vi.fn(async () => {}),
    createNew: vi.fn(async () => {}),
    showToast,
    refreshHome: vi.fn(async () => {}),
    openSettings: vi.fn(),
  }
}

let container: HTMLElement | null = null
let root: Root | null = null

async function render(node: ReactNode): Promise<HTMLElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<MobileLocaleProvider lang="ko">{node}</MobileLocaleProvider>)
  })
  return container
}

async function click(el: Element | null): Promise<void> {
  expect(el).not.toBeNull()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
}

function byTestId(id: string): HTMLElement | null {
  return document.body.querySelector(`[data-testid="${id}"]`)
}

function setClipboard(writeText: ((text: string) => Promise<void>) | null): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  })
}

beforeEach(() => {
  resetHomePrefsForTest()
  resetHomeRuntimeForTest()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  setClipboard(null)
  resetHomeRuntimeForTest()
  resetHomePrefsForTest()
})

describe('HelpSection', () => {
  it('draws every row without a runtime and opens each article in a sheet', async () => {
    await render(<HelpSection onClose={() => {}} />)
    for (const id of ['home-help-replay', 'home-help-feedback', 'home-help-whats-new']) {
      expect(byTestId(id)).not.toBeNull()
    }
    expect(HELP_ARTICLES).toHaveLength(6)
    for (const article of HELP_ARTICLES) {
      await click(byTestId(`home-help-article-${article.id}`))
      const sheet = byTestId('home-help-article-sheet')
      expect(sheet?.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(
        koHelp[article.titleKey as keyof typeof koHelp],
      )
      const paragraphs = byTestId(`home-help-article-${article.id}-body`)?.querySelectorAll('p')
      expect(paragraphs).toHaveLength(article.bodyKeys.length)
      expect(article.bodyKeys.length).toBeGreaterThanOrEqual(3)
      await click(sheet!.querySelector('button[aria-label="닫기"]'))
      expect(byTestId('home-help-article-sheet')).toBeNull()
    }
  })

  it('"show the welcome guide again" writes firstRunDone=false, then closes settings', async () => {
    const fake = fakeClient()
    setHomeRuntime(hostFor(fake.client))
    const onClose = vi.fn()
    await render(<HelpSection onClose={onClose} />)
    await click(byTestId('home-help-replay'))
    expect(fake.setAppPrefs).toHaveBeenCalledWith({ firstRunDone: false })
    expect(getHomePrefs().firstRunDone).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps settings open and says so when the replay cannot be saved', async () => {
    const fake = fakeClient({ failSave: true })
    const showToast = vi.fn()
    setHomeRuntime(hostFor(fake.client, showToast))
    const onClose = vi.fn()
    await render(<HelpSection onClose={onClose} />)
    await click(byTestId('home-help-replay'))
    expect(onClose).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: koHelp.homeHelpReplayFailed }),
    )
  })

  it('replays in memory and closes when there is no runtime', async () => {
    const onClose = vi.fn()
    await render(<HelpSection onClose={onClose} />)
    await click(byTestId('home-help-replay'))
    expect(getHomePrefs().firstRunDone).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('"what\'s new" shows the latest entry up to the app version', async () => {
    const fake = fakeClient()
    setHomeRuntime(hostFor(fake.client))
    await render(<HelpSection onClose={() => {}} />)
    await click(byTestId('home-help-whats-new'))
    const sheet = byTestId('home-help-whats-new-sheet')
    expect(sheet?.textContent).toContain('0.1.0')
    expect(sheet?.querySelectorAll('li')).toHaveLength(WHATS_NEW_ENTRIES[0]!.itemKeys.length)
  })

  it('markWhatsNewSeen writes lastSeenVersion', async () => {
    const fake = fakeClient()
    await markWhatsNewSeen('0.2.0', fake.client)
    expect(fake.setAppPrefs).toHaveBeenCalledWith({ lastSeenVersion: '0.2.0' })
    expect(getHomePrefs().lastSeenVersion).toBe('0.2.0')
  })
})

describe('send feedback', () => {
  it('uses the PC survey address, which is https', () => {
    expect(FEEDBACK_SURVEY_URL).toBe(PC_SURVEY_URL)
    expect(FEEDBACK_SURVEY_URL.startsWith('https://')).toBe(true)
  })

  it('carries the PC wording in every language', () => {
    for (const lang of LANGS) {
      const pc = FEEDBACK_STRINGS[lang]
      const mobile = homeStrings[lang] as Record<string, string>
      expect(mobile.homeHelpFeedbackTitle, lang).toBe(pc.dialogTitle)
      expect(mobile.homeHelpFeedbackBody, lang).toBe(pc.dialogBody)
      expect(mobile.homeHelpFeedbackDetails, lang).toBe(pc.details)
      expect(mobile.homeHelpFeedbackOpen, lang).toBe(pc.btnOpen)
      expect(mobile.homeHelpFeedbackCancel, lang).toBe(pc.btnCancel)
    }
  })

  it('names the OS with its version', () => {
    expect(feedbackOsLabel({ platform: 'android', osVersion: '15' })).toBe('Android 15')
    expect(feedbackOsLabel({ platform: 'ios', osVersion: '18.1' })).toBe('iOS 18.1')
    expect(feedbackOsLabel({ platform: 'ios', osVersion: '' })).toBe('iOS')
    expect(feedbackOsLabel({ platform: 'other', osVersion: '' })).toBe('')
  })

  it('shows the details, copies them, and opens exactly the survey once', async () => {
    const fake = fakeClient()
    setHomeRuntime(hostFor(fake.client))
    const writeText = vi.fn(async () => {})
    setClipboard(writeText)
    await render(<HelpSection onClose={() => {}} />)
    await click(byTestId('home-help-feedback'))

    const dialog = byTestId('home-help-feedback-dialog')
    expect(dialog?.querySelector('[role="alertdialog"]')).not.toBeNull()
    const details = byTestId('home-help-feedback-details')?.textContent ?? ''
    expect(details).toContain('0.1.0')
    expect(details).toContain('Android 15')
    expect(details).toContain('ko')

    await click(byTestId('home-help-feedback-open'))
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith('버전 0.1.0\n운영체제 Android 15\n화면 언어 ko')
    const opened = fake.invoke.mock.calls.filter(([command]) => command === OPEN_URL)
    expect(opened).toEqual([[OPEN_URL, { url: FEEDBACK_SURVEY_URL }]])
    for (const [, args] of opened) {
      expect(String((args as { url: string }).url).startsWith('https://')).toBe(true)
    }
    // Nothing else leaves the app: only the app info read and the browser opening.
    expect(new Set(fake.invoke.mock.calls.map(([command]) => command))).toEqual(
      new Set([APP_INFO, OPEN_URL]),
    )
    expect(byTestId('home-help-feedback-dialog')).toBeNull()
  })

  it('[Cancel] opens nothing and copies nothing', async () => {
    const fake = fakeClient()
    setHomeRuntime(hostFor(fake.client))
    const writeText = vi.fn(async () => {})
    setClipboard(writeText)
    await render(<HelpSection onClose={() => {}} />)
    await click(byTestId('home-help-feedback'))
    await click(byTestId('home-help-feedback-cancel'))
    expect(writeText).not.toHaveBeenCalled()
    expect(fake.invoke.mock.calls.some(([command]) => command === OPEN_URL)).toBe(false)
    expect(byTestId('home-help-feedback-dialog')).toBeNull()
  })

  it.each([
    ['rejects', () => setClipboard(vi.fn(async () => Promise.reject(new Error('denied'))))],
    ['is missing', () => setClipboard(null)],
  ])(
    'when the clipboard %s, shows the details as selectable text and still opens',
    async (_name, arrange) => {
      const fake = fakeClient({ appInfo: { version: '0.1.0', platform: 'ios', osVersion: '18.1' } })
      setHomeRuntime(hostFor(fake.client))
      arrange()
      await render(<HelpSection onClose={() => {}} />)
      await click(byTestId('home-help-feedback'))
      await click(byTestId('home-help-feedback-open'))

      const text = byTestId('home-help-feedback-text') as HTMLTextAreaElement | null
      expect(text).not.toBeNull()
      expect(text!.readOnly).toBe(true)
      expect(text!.value).toBe('버전 0.1.0\n운영체제 iOS 18.1\n화면 언어 ko')
      expect(fake.invoke.mock.calls.filter(([command]) => command === OPEN_URL)).toHaveLength(1)
      await click(byTestId('home-help-feedback-close'))
      expect(byTestId('home-help-feedback-dialog')).toBeNull()
    },
  )

  it('without a runtime the dialog works but opens nothing', async () => {
    const writeText = vi.fn(async () => {})
    setClipboard(writeText)
    await render(<HelpSection onClose={() => {}} />)
    await click(byTestId('home-help-feedback'))
    await click(byTestId('home-help-feedback-open'))
    expect(writeText).toHaveBeenCalledWith('버전 -\n운영체제 -\n화면 언어 ko')
    expect(byTestId('home-help-feedback-dialog')).toBeNull()
  })
})
