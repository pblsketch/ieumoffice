import type {
  HwpBackupEntry,
  MobileAiSettingsSnapshot,
  MobileAppPrefs,
  MobileAppPrefsPatch,
  MobileChatGptStatus,
  MobileRestoreTarget,
} from '@genoffice/mobile-bridge/transport'
import type { MobileAiSettingsSlot } from '../ai/settingsSlot'
import { useMobileLocale } from '../i18n'
import { useBackLayer } from '../shell/backStack'
import { IconBack, IeumAppIcon } from '../components/MobileIcons'
import { AiEnabledRow, AiSection } from './sections/AiSection'
import { BackupsSection } from './sections/BackupsSection'
import { GeneralSection } from './sections/GeneralSection'
import { StorageSection } from './sections/StorageSection'

export interface SettingsScreenProps {
  readonly prefs: MobileAppPrefs
  readonly aiSettings: MobileAiSettingsSnapshot
  readonly chatgptStatus: MobileChatGptStatus
  readonly backups: readonly HwpBackupEntry[]
  readonly onBack: () => void
  readonly onUpdatePrefs: (patch: MobileAppPrefsPatch) => void
  readonly onSelectProvider: (provider: string) => void
  readonly onValidateAndSaveKey: (params: {
    readonly provider: string
    readonly apiKey: string
    readonly freeOnly?: boolean
  }) => Promise<void>
  readonly onRemoveKey: (provider: string) => Promise<void>
  readonly onChatgptSignIn: (reconsent?: boolean) => Promise<void>
  readonly onChatgptSignOut: () => Promise<void>
  readonly onRestoreBackup: (backupId: string, target: MobileRestoreTarget) => Promise<void>
  readonly onDeleteBackup: (backupId: string) => Promise<void>
  readonly aiSlot?: MobileAiSettingsSlot
}

export function SettingsScreen({
  prefs,
  aiSettings,
  chatgptStatus,
  backups,
  onBack,
  onUpdatePrefs,
  onSelectProvider,
  onValidateAndSaveKey,
  onRemoveKey,
  onChatgptSignIn,
  onChatgptSignOut,
  onRestoreBackup,
  onDeleteBackup,
  aiSlot,
}: SettingsScreenProps) {
  const { t } = useMobileLocale()
  useBackLayer(true, onBack)

  return (
    <div className="mobile-page" data-testid="mobile-settings-screen">
      <header className="mobile-appbar">
        <button
          type="button"
          className="mobile-icon-btn"
          onClick={onBack}
          aria-label={t('back')}
          title={t('back')}
        >
          <IconBack size={22} />
        </button>
        <h1 className="mobile-appbar-title">{t('settingsTitle')}</h1>
        <span className="mobile-header-spacer" aria-hidden="true" />
      </header>

      <main className="mobile-page-body">
        <GeneralSection prefs={prefs} onUpdatePrefs={onUpdatePrefs}>
          <AiEnabledRow prefs={prefs} onUpdatePrefs={onUpdatePrefs} />
        </GeneralSection>

        <AiSection
          prefs={prefs}
          aiSettings={aiSettings}
          chatgptStatus={chatgptStatus}
          onSelectProvider={onSelectProvider}
          onValidateAndSaveKey={onValidateAndSaveKey}
          onRemoveKey={onRemoveKey}
          onChatgptSignIn={onChatgptSignIn}
          onChatgptSignOut={onChatgptSignOut}
          slot={aiSlot}
        />

        <BackupsSection
          backups={backups}
          onRestoreBackup={onRestoreBackup}
          onDeleteBackup={onDeleteBackup}
        />

        <StorageSection aiSlot={aiSlot} />

        <footer className="mobile-about-footer">
          <IeumAppIcon size={24} />
          <span className="mobile-about-name">{t('appTitle')}</span>
          <span className="mobile-about-ver">v0.1.0</span>
        </footer>
      </main>
    </div>
  )
}
