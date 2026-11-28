import { useEffect, useState, useSyncExternalStore } from 'react'
import { AI_MEDIA_PROVIDERS } from '@genoffice/ai-provider/browser'
import type {
  MobileAiImageProvider,
  MobileAiToolSettingsPatch,
} from '@genoffice/mobile-bridge/ai-bridge'
import { useMobileLocale, type MobileStringKey } from '../i18n'
import { toolSettingsReason } from './settingsText'
import { mobileImageModelChoice } from './tools/imageModel'
import {
  MOBILE_IMAGE_PROVIDERS,
  mobileAiToolSettings,
  onMobileAiToolSettingsChanged,
  refreshMobileAiToolSettings,
  updateMobileAiToolSettings,
} from './tools/state'

function same(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** The provider's catalog image models in listed order, plus a saved model the catalog lacks. */
export function imageModelOptions(provider: MobileAiImageProvider, saved: string): string[] {
  const catalog = AI_MEDIA_PROVIDERS.find((m) => m.id === provider)?.imageModels ?? []
  const name = saved.trim()
  return name && !catalog.some((m) => same(m, name)) ? [...catalog, name] : [...catalog]
}

function defaultImageModel(provider: MobileAiImageProvider): string {
  const meta = AI_MEDIA_PROVIDERS.find((m) => m.id === provider)
  return meta?.defaultImageModel ?? meta?.imageModels[0] ?? ''
}

function providerLabel(provider: MobileAiImageProvider): string {
  return AI_MEDIA_PROVIDERS.find((m) => m.id === provider)?.label ?? provider
}

export interface AiToolsCardProps {
  /** Changes when a key is added or removed, so the ready image providers are read again. */
  readonly keysVersion: string
}

/**
 * The AI tool switches (spec 3.5): the internet tools (on by default) and
 * picture making (off by default). Picture making needs an image provider
 * whose key is connected (OpenAI or Gemini; never OpenRouter) and an image
 * model from that provider's catalog; it is only ever turned on here, by the
 * person. Values live in Rust's AI tool settings; the tools module caches
 * them and tells a running guard about the internet switch.
 */
export function AiToolsCard({ keysVersion }: AiToolsCardProps) {
  const { t } = useMobileLocale()
  const settings = useSyncExternalStore(
    onMobileAiToolSettingsChanged,
    mobileAiToolSettings,
    mobileAiToolSettings,
  )
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState<MobileStringKey | null>(null)
  // the provider and model picked while picture making is off (saved when it is turned on)
  const [draft, setDraft] = useState<{
    readonly provider: MobileAiImageProvider
    readonly model: string
  } | null>(null)

  useEffect(() => {
    let live = true
    // A microtask later: when this card mounts with the AI hook (tests), the
    // hook binds the tools in its own effect, which runs after this one.
    void Promise.resolve()
      .then(refreshMobileAiToolSettings)
      .finally(() => {
        if (live) setLoaded(true)
      })
    return () => {
      live = false
    }
  }, [keysVersion])

  const ready = (settings?.imageProvidersReady ?? []).filter((p) =>
    MOBILE_IMAGE_PROVIDERS.includes(p),
  )
  const savedModelFor = (provider: MobileAiImageProvider): string =>
    settings?.imageProvider === provider ? (settings.imageModel ?? '') : ''
  const savedProvider =
    settings?.imageProvider && ready.includes(settings.imageProvider)
      ? settings.imageProvider
      : null
  const provider =
    draft && ready.includes(draft.provider) ? draft.provider : (savedProvider ?? ready[0] ?? null)
  const model = provider
    ? draft?.provider === provider
      ? draft.model
      : savedModelFor(provider) || defaultImageModel(provider)
    : ''
  const imageOn = settings?.imageGeneration === true

  const save = async (patch: MobileAiToolSettingsPatch): Promise<boolean> => {
    setBusy(true)
    setReason(null)
    try {
      const next = await updateMobileAiToolSettings(patch)
      if (!next) {
        setReason('aiToolsErrSaveFailed')
        return false
      }
      return true
    } catch (err) {
      setReason(toolSettingsReason(err))
      // what Rust holds now (a key may have gone), so the switches tell the truth
      await refreshMobileAiToolSettings()
      return false
    } finally {
      setBusy(false)
    }
  }

  const toggleImage = async (on: boolean) => {
    if (!on) {
      await save({ imageGeneration: false })
      return
    }
    if (!provider) return
    const choice = mobileImageModelChoice(model, provider, savedModelFor(provider))
    if (choice.kind === 'refuse' || !choice.model) {
      setReason('aiToolsErrModelInvalid')
      return
    }
    if (await save({ imageGeneration: true, imageProvider: provider, imageModel: choice.model })) {
      setDraft(null)
    }
  }

  const pickRoute = async (next: { provider: MobileAiImageProvider; model: string }) => {
    setDraft(next)
    // while picture making is on, the route in use changes at once
    if (imageOn && (await save({ imageProvider: next.provider, imageModel: next.model }))) {
      setDraft(null)
    }
  }

  const unavailable = loaded && settings !== null && ready.length === 0

  return (
    <div className="mobile-card" data-testid="ai-tools-card">
      <h3 className="mobile-card-subtitle">{t('aiToolsTitle')}</h3>

      <label className="ai-set-switch-row">
        <span className="ai-set-switch-text">
          <span className="mobile-set-label">{t('aiToolsInternet')}</span>
          <span className="ai-set-hint">{t('aiToolsInternetHint')}</span>
        </span>
        <input
          type="checkbox"
          className="mobile-switch"
          checked={settings?.internetTools === true}
          disabled={busy || settings === null}
          onChange={(e) => void save({ internetTools: e.target.checked })}
          data-testid="ai-tools-internet-toggle"
        />
      </label>

      <label className="ai-set-switch-row">
        <span className="ai-set-switch-text">
          <span className="mobile-set-label">{t('aiToolsImage')}</span>
          <span className="ai-set-hint">{t('aiToolsImageHint')}</span>
        </span>
        <input
          type="checkbox"
          className="mobile-switch"
          checked={imageOn}
          disabled={busy || settings === null || (!imageOn && provider === null)}
          onChange={(e) => void toggleImage(e.target.checked)}
          data-testid="ai-tools-image-toggle"
        />
      </label>
      {unavailable && (
        <p className="ai-set-hint" data-testid="ai-tools-image-unavailable">
          {t('aiToolsImageNoProvider')}
        </p>
      )}

      {provider && (
        <div className="ai-set-form">
          <label className="ai-set-field">
            <span className="ai-set-field-label">{t('aiToolsImageProvider')}</span>
            <select
              className="mobile-input"
              value={provider}
              disabled={busy}
              onChange={(e) => {
                const next = e.target.value as MobileAiImageProvider
                if (!ready.includes(next)) return
                void pickRoute({
                  provider: next,
                  model: savedModelFor(next) || defaultImageModel(next),
                })
              }}
              data-testid="ai-tools-image-provider"
            >
              {ready.map((p) => (
                <option key={p} value={p}>
                  {providerLabel(p)}
                </option>
              ))}
            </select>
          </label>
          <label className="ai-set-field">
            <span className="ai-set-field-label">{t('aiToolsImageModel')}</span>
            <select
              className="mobile-input"
              value={model}
              disabled={busy}
              onChange={(e) => void pickRoute({ provider, model: e.target.value })}
              data-testid="ai-tools-image-model"
            >
              {imageModelOptions(provider, savedModelFor(provider)).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {reason && (
        <p className="ai-set-reason" role="alert" data-testid="ai-tools-reason">
          {t(reason)}
        </p>
      )}
      {loaded && settings === null && <p className="ai-set-reason">{t('aiToolsUnreadable')}</p>}
    </div>
  )
}
