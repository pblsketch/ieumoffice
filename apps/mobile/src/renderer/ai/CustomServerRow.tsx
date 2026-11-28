import { useEffect, useState } from 'react'
import {
  clearMobileAiCustomEndpoint,
  getMobileAiCustomEndpoint,
  setMobileAiCustomEndpoint,
  type MobileAiCustomEndpoint,
} from '@genoffice/mobile-bridge/ai-bridge'
import type { MobileAiSettingsSnapshot, MobileClient } from '@genoffice/mobile-bridge/transport'
import { IconChevronDown, IconChevronRight } from '../components/MobileIcons'
import { useMobileLocale, type MobileStringKey } from '../i18n'
import { listCustomServerModels } from './customServer'
import { customServerReason } from './settingsText'

/** What the person is typing; AiSection keeps it so it survives AI off and on. */
export interface CustomServerDraft {
  readonly url: string
  readonly key: string
  readonly model: string
}

export const EMPTY_CUSTOM_DRAFT: CustomServerDraft = { url: '', key: '', model: '' }

const NO_ENDPOINT: MobileAiCustomEndpoint = {
  baseUrl: null,
  hasKey: false,
  model: null,
  models: [],
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

export interface CustomServerRowProps {
  readonly client: MobileClient
  readonly selectedProvider: string
  readonly applyAiSettings?: (snapshot: MobileAiSettingsSnapshot) => void
  readonly draft: CustomServerDraft
  readonly onDraft: (patch: Partial<CustomServerDraft>) => void
  readonly expanded: boolean
  readonly onToggle: () => void
}

/**
 * The self-hosted server (`custom`) among the AI connections: an HTTPS base
 * URL (required) and a key (optional). [Check and save] saves the endpoint
 * first, so the relay lets requests through to its host, then reads
 * `<base>/models` through the relay; with a list it saves the first model and
 * selects the server. When the list cannot be read the endpoint stays and the
 * person types the model. Rust holds the key; this row never shows it.
 */
export function CustomServerRow({
  client,
  selectedProvider,
  applyAiSettings,
  draft,
  onDraft,
  expanded,
  onToggle,
}: CustomServerRowProps) {
  const { t } = useMobileLocale()
  const [endpoint, setEndpoint] = useState<MobileAiCustomEndpoint | null>(null)
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState<MobileStringKey | null>(null)
  const [listFailed, setListFailed] = useState(false)

  useEffect(() => {
    let live = true
    getMobileAiCustomEndpoint(client).then(
      (saved) => {
        if (live) setEndpoint(saved)
      },
      () => {
        if (live) setEndpoint(NO_ENDPOINT)
      },
    )
    return () => {
      live = false
    }
  }, [client])

  const refreshSnapshot = async () => {
    try {
      applyAiSettings?.(await client.getAiSettings())
    } catch {
      // the AI sheet reads the settings again before its next run
    }
  }

  const selectServer = async () => {
    applyAiSettings?.(await client.setAiSettings({ selectedProvider: 'custom' }))
  }

  const run = async (work: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setReason(null)
    try {
      await work()
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    run(async () => {
      const baseUrl = draft.url.trim()
      if (!baseUrl) return
      setListFailed(false)
      const key = draft.key.trim()
      let saved: MobileAiCustomEndpoint
      try {
        saved = await setMobileAiCustomEndpoint(client, {
          baseUrl,
          ...(key ? { apiKey: key } : {}),
        })
      } catch (err) {
        setReason(customServerReason(err))
        return
      }
      onDraft({ url: '', key: '' })
      setEndpoint(saved)
      // a list that cannot be read (or an empty one) leaves the model to the person
      const models = await listCustomServerModels(client, saved).catch((): string[] => [])
      if (models.length === 0 || !saved.baseUrl) {
        setListFailed(true)
        await refreshSnapshot()
        return
      }
      const model = saved.model && models.includes(saved.model) ? saved.model : models[0]!
      try {
        setEndpoint(
          await setMobileAiCustomEndpoint(client, { baseUrl: saved.baseUrl, model, models }),
        )
        await selectServer()
      } catch (err) {
        setReason(customServerReason(err))
        await refreshSnapshot()
      }
    })

  const saveModel = (name: string, select: boolean) =>
    run(async () => {
      const model = name.trim()
      if (!model || !endpoint?.baseUrl) return
      try {
        setEndpoint(await setMobileAiCustomEndpoint(client, { baseUrl: endpoint.baseUrl, model }))
        onDraft({ model: '' })
        setListFailed(false)
        if (select) await selectServer()
        else await refreshSnapshot()
      } catch (err) {
        setReason(customServerReason(err))
      }
    })

  const use = () =>
    run(async () => {
      try {
        await selectServer()
      } catch (err) {
        setReason(customServerReason(err))
      }
    })

  const clear = () =>
    run(async () => {
      try {
        setEndpoint(await clearMobileAiCustomEndpoint(client))
        setListFailed(false)
        onDraft(EMPTY_CUSTOM_DRAFT)
        await refreshSnapshot()
      } catch (err) {
        setReason(customServerReason(err))
      }
    })

  const connected = Boolean(endpoint?.baseUrl)
  const inUse = connected && selectedProvider === 'custom'

  const form = (
    <div className="ai-set-form">
      <label className="ai-set-field">
        <span className="ai-set-field-label">{t('aiCustomUrlLabel')}</span>
        <input
          type="url"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="mobile-input"
          value={draft.url}
          placeholder="https://"
          onChange={(e) => onDraft({ url: e.target.value })}
          data-testid="ai-custom-url"
        />
      </label>
      <label className="ai-set-field">
        <span className="ai-set-field-label">{t('aiCustomKeyLabel')}</span>
        <input
          type="password"
          autoComplete="off"
          className="mobile-input"
          value={draft.key}
          onChange={(e) => onDraft({ key: e.target.value })}
          data-testid="ai-custom-key"
        />
      </label>
      <button
        type="button"
        className="mobile-touch-btn mobile-btn-primary"
        disabled={busy || !draft.url.trim()}
        onClick={() => void save()}
        data-testid="ai-custom-save"
      >
        {t('aiCustomSave')}
      </button>
    </div>
  )

  const savedView = endpoint?.baseUrl ? (
    <div className="ai-set-form">
      <p className="mobile-muted" data-testid="ai-custom-host">
        {t('aiCustomHost', { host: hostOf(endpoint.baseUrl) })}
      </p>
      {endpoint.models.length > 0 ? (
        <label className="ai-set-field">
          <span className="ai-set-field-label">{t('aiCustomModelLabel')}</span>
          <select
            className="mobile-input"
            value={endpoint.model ?? ''}
            disabled={busy}
            onChange={(e) => void saveModel(e.target.value, false)}
            data-testid="ai-custom-model-select"
          >
            {!endpoint.model && <option value="">{t('aiCustomNoModel')}</option>}
            {endpoint.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <p className="mobile-muted" data-testid="ai-custom-model">
            {endpoint.model ? t('aiCustomModel', { model: endpoint.model }) : t('aiCustomNoModel')}
          </p>
          {listFailed && (
            <p className="ai-set-hint" data-testid="ai-custom-list-failed">
              {t('aiCustomListFailed')}
            </p>
          )}
          <label className="ai-set-field">
            <span className="ai-set-field-label">{t('aiCustomModelLabel')}</span>
            <input
              type="text"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="mobile-input"
              value={draft.model}
              onChange={(e) => onDraft({ model: e.target.value })}
              data-testid="ai-custom-model-input"
            />
          </label>
          <button
            type="button"
            className="mobile-touch-btn mobile-btn-secondary"
            disabled={busy || !draft.model.trim()}
            onClick={() => void saveModel(draft.model, true)}
            data-testid="ai-custom-model-save"
          >
            {t('aiCustomModelSave')}
          </button>
        </>
      )}
      <div className="mobile-row-actions">
        <button
          type="button"
          className="mobile-touch-btn mobile-btn-secondary"
          disabled={busy || inUse || !endpoint.model}
          onClick={() => void use()}
          data-testid="ai-custom-use"
        >
          {t('aiCustomUse')}
        </button>
        <button
          type="button"
          className="mobile-touch-btn mobile-btn-ghost mobile-btn-danger-text"
          disabled={busy}
          onClick={() => void clear()}
          data-testid="ai-custom-clear"
        >
          {t('aiClear')}
        </button>
      </div>
    </div>
  ) : null

  return (
    <div className="mobile-accordion-item" data-testid="ai-custom-server">
      <button
        type="button"
        className="mobile-accordion-trigger"
        onClick={onToggle}
        aria-expanded={expanded}
        data-testid="ai-custom-trigger"
      >
        <span className="mobile-accordion-left">
          <span
            className={connected ? 'mobile-status-dot connected' : 'mobile-status-dot'}
            aria-hidden="true"
          />
          <span className="mobile-accordion-title">{t('aiModelCustomServer')}</span>
        </span>
        <span className="mobile-accordion-right">
          {inUse && <span className="mobile-badge mobile-badge-ok">{t('aiCustomInUse')}</span>}
          {expanded ? (
            <IconChevronDown size={17} className="mobile-chevron" />
          ) : (
            <IconChevronRight size={17} className="mobile-chevron" />
          )}
        </span>
      </button>
      {expanded && (
        <div className="mobile-accordion-body">
          {endpoint === null ? null : connected ? savedView : form}
          {reason && (
            <p className="ai-set-reason" role="alert" data-testid="ai-custom-reason">
              {t(reason)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
