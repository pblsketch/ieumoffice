// Owner: track T6. "Keep the screen on while reading" switch (spec 3.15).
import { useId } from 'react'
import { useHomeRuntime } from '../../home/homeRuntime'
import { updateHomePrefs } from '../../home/prefsStore'
import { useMobileLocale } from '../../i18n'
import { useSettingsPrefs } from './settingsHooks'
import './homeSettings.css'

export function KeepScreenOnRow() {
  const { t } = useMobileLocale()
  const runtime = useHomeRuntime()
  const { prefs } = useSettingsPrefs()
  const descId = useId()

  return (
    <label className="mobile-set-row">
      <span className="home-set-text">
        <span className="mobile-set-label">{t('homeSetKeepScreenOn')}</span>
        <span id={descId} className="home-set-desc">
          {t('homeSetKeepScreenOnDesc')}
        </span>
      </span>
      <input
        type="checkbox"
        role="switch"
        className="mobile-switch"
        aria-describedby={descId}
        checked={prefs.keepScreenOnWhileReading}
        onChange={(e) => {
          updateHomePrefs({ keepScreenOnWhileReading: e.target.checked }).catch(() =>
            runtime?.showToast({ message: t('homeSetFailed'), tone: 'error' }),
          )
        }}
        data-testid="home-set-keep-screen-on"
      />
    </label>
  )
}
