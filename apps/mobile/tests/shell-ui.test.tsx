import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SUBSCRIPTION_CHATGPT_USAGE_URL } from '@genoffice/ai-provider/browser'
import type {
  MobileAiSettingsSnapshot,
  MobileAppPrefs,
  MobileChatGptStatus,
} from '@genoffice/mobile-bridge/transport'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { HomeScreen } from '../src/renderer/components/HomeScreen'
import { EditorShell } from '../src/renderer/shell/EditorShell'
import { SettingsScreen } from '../src/renderer/settings/SettingsScreen'

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

const defaultPrefs: MobileAppPrefs = {
  lang: 'ko',
  theme: 'system',
  hwpDefaultFormat: 'hwp',
  aiEnabled: true,
}

const baseAiSettings: MobileAiSettingsSnapshot = {
  selectedProvider: 'auto',
  modelByProvider: {},
  configuredProviders: {
    openrouter: {
      hasKey: true,
      freeOnly: true,
      models: ['meta-llama/llama-3.3-70b-instruct:free'],
    },
  },
  chatgptVisible: false,
  subscriptionNoticeVersion: 0,
}

describe('responsive mobile shell layout (<768px phone vs >=768px tablet)', () => {
  it('renders phone quick toolbar in edit mode and bottom sheet AI on <768px', () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
    const el = renderInDom(
      <EditorShell
        docTitle="plan.md"
        docFormat="md"
        dirty={false}
        mode="edit"
        canEdit={true}
        aiEnabled={true}
        quickActions={[{ id: 'bold', label: 'B', onPress: () => {} }]}
        aiPanelContent={<div>AI Content</div>}
        onBack={() => {}}
        onToggleMode={() => {}}
        onSave={() => {}}
        onSaveAs={() => {}}
        onShare={() => {}}
        onFitToWidth={() => {}}
        onOpenBackups={() => {}}
      >
        <div>Doc body</div>
      </EditorShell>,
    )

    expect(el.querySelector('[data-layout="phone"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="phone-quick-toolbar"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="tablet-toolbar"]')).toBeNull()
  })

  it('renders tablet toolbar and docked AI toggle on >=768px', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true })
    const el = renderInDom(
      <EditorShell
        docTitle="report.hwp"
        docFormat="hwp"
        dirty={true}
        mode="edit"
        canEdit={true}
        aiEnabled={true}
        quickActions={[{ id: 'undo', label: 'Undo', onPress: () => {} }]}
        aiPanelContent={<div>AI Dock</div>}
        onBack={() => {}}
        onToggleMode={() => {}}
        onSave={() => {}}
        onSaveAs={() => {}}
        onShare={() => {}}
        onFitToWidth={() => {}}
        onOpenBackups={() => {}}
      >
        <div>HWP body</div>
      </EditorShell>,
    )

    expect(el.querySelector('[data-layout="tablet"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="tablet-toolbar"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="phone-quick-toolbar"]')).toBeNull()
    expect(el.querySelector('[data-testid="tablet-ai-toggle"]')).not.toBeNull()
  })
})

describe('SettingsScreen ChatGPT visibility gate, usage link, and HWP backup actions', () => {
  it('hides the ChatGPT card completely when chatgptVisible is false', () => {
    const el = renderInDom(
      <SettingsScreen
        prefs={defaultPrefs}
        aiSettings={{ ...baseAiSettings, chatgptVisible: false }}
        chatgptStatus={{ state: 'hidden' }}
        backups={[]}
        onBack={() => {}}
        onUpdatePrefs={() => {}}
        onSelectProvider={() => {}}
        onValidateAndSaveKey={async () => {}}
        onRemoveKey={async () => {}}
        onChatgptSignIn={async () => {}}
        onChatgptSignOut={async () => {}}
        onRestoreBackup={async () => {}}
        onDeleteBackup={async () => {}}
      />,
    )

    expect(el.querySelector('[data-testid="settings-chatgpt-card"]')).toBeNull()
    expect(el.querySelector('[data-testid="settings-free-ai-section"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="settings-byok-section"]')).not.toBeNull()
  })

  it('renders ChatGPT card with Manage usage URL when visible and wires HWP backup actions', () => {
    const restoreSpy = vi.fn(async () => {})
    const readyStatus: MobileChatGptStatus = {
      state: 'ready',
      account: 'user@example.com',
      sharing: true,
    }
    const el = renderInDom(
      <SettingsScreen
        prefs={defaultPrefs}
        aiSettings={{ ...baseAiSettings, chatgptVisible: true }}
        chatgptStatus={readyStatus}
        backups={[
          {
            backupId: 'bk-1',
            docKey: '0011223344556677',
            originalName: 'official.hwp',
            format: 'hwp',
            createdAt: 1700000000000,
            sizeBytes: 4096,
          },
        ]}
        onBack={() => {}}
        onUpdatePrefs={() => {}}
        onSelectProvider={() => {}}
        onValidateAndSaveKey={async () => {}}
        onRemoveKey={async () => {}}
        onChatgptSignIn={async () => {}}
        onChatgptSignOut={async () => {}}
        onRestoreBackup={restoreSpy}
        onDeleteBackup={async () => {}}
      />,
    )

    expect(el.querySelector('[data-testid="settings-chatgpt-card"]')).not.toBeNull()
    const link = el.querySelector<HTMLAnchorElement>('[data-testid="chatgpt-manage-usage-link"]')
    expect(link?.href).toBe(SUBSCRIPTION_CHATGPT_USAGE_URL)
    expect(el.querySelector('[data-testid="settings-backup-list"]')?.textContent).toContain(
      'official.hwp',
    )
  })
})

describe('HomeScreen permission-expired recent doc recovery UI', () => {
  it('shows permission expired recovery controls when a recent doc returns PERMISSION_DENIED', () => {
    const el = renderInDom(
      <HomeScreen
        recentDocs={[
          {
            id: 'rec-1',
            docKey: 'aaaa1111bbbb2222',
            name: 'moved.hwp',
            format: 'hwp',
            openedAt: 1700000000000,
          },
        ]}
        recoveryEntries={[]}
        permissionDeniedRecentId="rec-1"
        defaultHwpFormat="hwp"
        onCreateNew={() => {}}
        onOpenFile={() => {}}
        onOpenRecent={() => {}}
        onRemoveRecent={() => {}}
        onRestoreRecovery={() => {}}
        onDiscardRecovery={() => {}}
        onOpenSettings={() => {}}
      />,
    )

    expect(el.querySelector('[data-testid="recent-expired-rec-1"]')).not.toBeNull()
  })
})
