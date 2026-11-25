import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  MobileAiSettingsSnapshot,
  MobileAppPrefs,
  MobileAppPrefsPatch,
  MobileChatGptStatus,
} from '@genoffice/mobile-bridge/transport'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { ko } from '../src/renderer/i18n/ko'
import { SettingsScreen, type SettingsScreenProps } from '../src/renderer/settings/SettingsScreen'

// HTML of the settings screen captured before it was split into per-track
// sections. The split must not change a single byte of the rendered DOM.
const FIXTURE_PATH = join(__dirname, 'fixtures/settings-screen-dom.json')

const containers: HTMLElement[] = []

function renderInDom(node: React.ReactNode): HTMLElement {
  const div = document.createElement('div')
  document.body.appendChild(div)
  containers.push(div)
  const root = createRoot(div)
  act(() => {
    root.render(<MobileLocaleProvider lang="ko">{node}</MobileLocaleProvider>)
  })
  return div
}

afterEach(() => {
  while (containers.length > 0) {
    const el = containers.pop()
    el?.remove()
  }
})

const aiOnPrefs: MobileAppPrefs = {
  lang: 'ko',
  theme: 'system',
  hwpDefaultFormat: 'hwp',
  aiEnabled: true,
}

const fixedAiSettings: MobileAiSettingsSnapshot = {
  selectedProvider: 'openrouter',
  modelByProvider: {},
  configuredProviders: {
    openrouter: {
      hasKey: true,
      freeOnly: true,
      models: ['meta-llama/llama-3.3-70b-instruct:free'],
    },
  },
  chatgptVisible: true,
  subscriptionNoticeVersion: 0,
}

const readyStatus: MobileChatGptStatus = {
  state: 'ready',
  account: 'user@example.com',
  sharing: true,
}

function fixedProps(overrides: Partial<SettingsScreenProps> = {}): SettingsScreenProps {
  return {
    prefs: aiOnPrefs,
    aiSettings: fixedAiSettings,
    chatgptStatus: readyStatus,
    backups: [
      {
        backupId: 'bk-1',
        docKey: '0011223344556677',
        originalName: 'official.hwp',
        format: 'hwp',
        createdAt: 1700000000000,
        sizeBytes: 4096,
      },
    ],
    onBack: () => {},
    onUpdatePrefs: () => {},
    onSelectProvider: () => {},
    onValidateAndSaveKey: async () => {},
    onRemoveKey: async () => {},
    onChatgptSignIn: async () => {},
    onChatgptSignOut: async () => {},
    onRestoreBackup: async () => {},
    onDeleteBackup: async () => {},
    ...overrides,
  }
}

function StatefulSettings(props: Partial<SettingsScreenProps>) {
  const [prefs, setPrefs] = useState<MobileAppPrefs>(aiOnPrefs)
  const onUpdatePrefs = (patch: MobileAppPrefsPatch) => {
    setPrefs((prev) => ({ ...prev, ...patch }))
  }
  return <SettingsScreen {...fixedProps(props)} prefs={prefs} onUpdatePrefs={onUpdatePrefs} />
}

function click(el: Element | null) {
  if (!el) throw new Error('element not found')
  act(() => {
    ;(el as HTMLElement).click()
  })
}

function typeInto(input: HTMLInputElement | null, value: string) {
  if (!input) throw new Error('input not found')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function accordionTrigger(el: HTMLElement, label: string): HTMLButtonElement | null {
  const triggers = el.querySelectorAll<HTMLButtonElement>('.mobile-accordion-trigger')
  return Array.from(triggers).find((b) => b.textContent?.includes(label)) ?? null
}

function aiSectionHeading(el: HTMLElement): Element | null {
  const headings = el.querySelectorAll('h2.mobile-section-heading')
  return Array.from(headings).find((h) => h.textContent === ko.settingsAiSection) ?? null
}

function captureDomStates(): Record<string, string> {
  const initial = renderInDom(<SettingsScreen {...fixedProps()} />)

  const expanded = renderInDom(<StatefulSettings />)
  click(accordionTrigger(expanded, 'Gemini'))
  typeInto(expanded.querySelector<HTMLInputElement>('.mobile-key-form input'), 'draft-key')

  const aiOff = renderInDom(
    <SettingsScreen {...fixedProps({ prefs: { ...aiOnPrefs, aiEnabled: false } })} />,
  )

  const signedOut = renderInDom(
    <SettingsScreen
      {...fixedProps({
        chatgptStatus: { state: 'signed-out', loginFailure: { reason: 'no-plan' } },
        backups: [],
      })}
    />,
  )

  return {
    initial: initial.innerHTML,
    expanded: expanded.innerHTML,
    aiOff: aiOff.innerHTML,
    signedOut: signedOut.innerHTML,
  }
}

describe('SettingsScreen split into per-track sections', () => {
  it('renders the same DOM as before the split', () => {
    const actual = captureDomStates()
    const expected = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Record<string, string>
    expect(actual).toEqual(expected)
  })

  it('keeps the AI switch as the last row of the general card', () => {
    const el = renderInDom(<SettingsScreen {...fixedProps()} />)
    const card = el.querySelector('.mobile-set-card')
    const rows = card?.querySelectorAll(':scope > .mobile-set-row')
    const last = rows?.[rows.length - 1]
    expect(last?.querySelector('[data-testid="settings-ai-enabled-toggle"]')).not.toBeNull()
  })

  it('keeps typed key drafts and the open provider when AI is switched off and on', () => {
    const el = renderInDom(<StatefulSettings />)
    expect(aiSectionHeading(el)).not.toBeNull()

    click(accordionTrigger(el, 'Gemini'))
    typeInto(el.querySelector<HTMLInputElement>('.mobile-key-form input'), 'draft-key')

    const toggle = el.querySelector('[data-testid="settings-ai-enabled-toggle"]')
    click(toggle)
    expect(el.querySelector('[data-testid="settings-free-ai-section"]')).toBeNull()
    expect(aiSectionHeading(el)).toBeNull()

    click(toggle)
    expect(aiSectionHeading(el)).not.toBeNull()
    const input = el.querySelector<HTMLInputElement>('.mobile-key-form input')
    expect(input?.value).toBe('draft-key')
  })
})
