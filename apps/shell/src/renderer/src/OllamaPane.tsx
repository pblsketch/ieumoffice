import { useEffect, useRef, useState } from 'react'
import {
  isLocalOllamaUrl,
  newCustomEndpointId,
  OLLAMA_CONNECT_TIMEOUT_MS,
  ollamaBaseUrl,
  prettyModelName,
} from '@genoffice/ai-provider/browser'
import type {
  OllamaEffortPreset,
  AiOllamaServer,
  AiSettings,
  OllamaModelInfo,
} from '@genoffice/ai-provider/browser'
import { useI18n } from './locale'
import { ollamaText, type OllamaStringKey } from './i18n/strings-ollama'
import { changeAiSettings, readAiSettings } from './settings-ai'
import {
  defaultOllamaServer,
  LOCAL_OLLAMA_URL,
  registerOllamaModel,
  removeOllamaServer,
  saveOllamaServer,
  unregisterOllamaModel,
  withDefaultOllamaServer,
} from './ollama-settings'
import './ollama.css'

type Change = (apply: (settings: AiSettings) => AiSettings) => Promise<boolean>

function ServerForm({
  server,
  busy,
  onSave,
  onCancel,
}: {
  server?: AiOllamaServer
  busy: boolean
  onSave: (server: AiOllamaServer) => Promise<boolean>
  onCancel: () => void
}) {
  const { lang, t: common } = useI18n()
  const t = (key: OllamaStringKey) => ollamaText(lang, key)
  const [name, setName] = useState(server?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(server?.baseUrl ?? LOCAL_OLLAMA_URL)
  const [apiKey, setApiKey] = useState(server?.apiKey ?? '')
  const [timeoutMin, setTimeoutMin] = useState(
    String(Math.round((server?.connectTimeoutMs ?? OLLAMA_CONNECT_TIMEOUT_MS) / 60_000)),
  )
  const normalized = ollamaBaseUrl(baseUrl)
  const timeoutMinutes = Math.min(10, Math.max(1, Math.round(Number(timeoutMin) || 5)))
  return (
    <form
      className="ollama-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (!name.trim() || !normalized || busy) return
        void onSave({
          id: server?.id ?? newCustomEndpointId(),
          name: name.trim(),
          baseUrl: normalized,
          apiKey: apiKey.trim(),
          endpointIds: server?.endpointIds ?? [],
          connectTimeoutMs: timeoutMinutes * 60_000,
        })
      }}
    >
      <fieldset disabled={busy}>
        <legend>{t(server ? 'editServer' : 'addServer')}</legend>
        <label className="set-field">
          <span className="set-field-label">{t('serverName')}</span>
          <input
            className="set-input"
            required
            maxLength={128}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
        </label>
        <label className="set-field">
          <span className="set-field-label">{common('setAiBaseUrl')}</span>
          <input
            className="set-input"
            required
            maxLength={2048}
            value={baseUrl}
            aria-invalid={!normalized}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </label>
        {!normalized && (
          <p className="ollama-error" role="alert">
            {t('invalidUrl')}
          </p>
        )}
        <details>
          <summary>{t('apiKeyOptional')}</summary>
          <label className="set-field">
            <span className="set-field-label">{common('setAiApiKey')}</span>
            <input
              type="password"
              className="set-input"
              autoComplete="off"
              maxLength={8192}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
          <p className="set-field-desc">{common('setAiKeyHint')}</p>
        </details>
        <label className="set-field">
          <span className="set-field-label">{t('connectTimeout')}</span>
          <input
            type="number"
            className="set-input"
            required
            min={1}
            max={10}
            step={1}
            value={timeoutMin}
            onChange={(event) => setTimeoutMin(event.target.value)}
          />
        </label>
        <p className="set-field-desc">{t('connectTimeoutHint')}</p>
        <div className="set-btn-row">
          <button type="button" className="set-btn" onClick={onCancel}>
            {common('cancel')}
          </button>
          <button type="submit" className="set-btn primary" disabled={!name.trim() || !normalized}>
            {server ? common('setAiSave') : t('addServer')}
          </button>
        </div>
      </fieldset>
    </form>
  )
}

const EFFORT_LEVELS: readonly OllamaEffortPreset[] = ['low', 'medium', 'high']

function ServerCard({
  server,
  settings,
  busy,
  change,
}: {
  server: AiOllamaServer
  settings: AiSettings
  busy: boolean
  change: Change
}) {
  const { lang, t: common } = useI18n()
  const t = (key: OllamaStringKey) => ollamaText(lang, key)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [timeoutDraft, setTimeoutDraft] = useState<string | null>(null)
  const [selectedEfforts, setSelectedEfforts] = useState<Record<string, OllamaEffortPreset[]>>({})
  const [catalog, setCatalog] = useState<{
    baseUrl: string
    apiKey: string
    models: string[]
    status: 'loading' | 'ok' | 'error'
  } | null>(null)
  const { baseUrl, apiKey } = server
  useEffect(() => {
    let alive = true
    setCatalog({ baseUrl, apiKey, models: [], status: 'loading' })
    void window.aiOffice.getCustomModels(baseUrl, apiKey).then(
      (result) => {
        if (!alive) return
        setCatalog({
          baseUrl,
          apiKey,
          models: result.models,
          status: result.reachable || result.models.length > 0 ? 'ok' : 'error',
        })
      },
      () => {
        if (alive) setCatalog({ baseUrl, apiKey, models: [], status: 'error' })
      },
    )
    return () => {
      alive = false
    }
  }, [baseUrl, apiKey, refresh])
  const [modelInfo, setModelInfo] = useState<Record<string, OllamaModelInfo>>({})
  useEffect(() => {
    const models = catalog?.status === 'ok' ? catalog.models : []
    if (models.length === 0) {
      setModelInfo({})
      return
    }
    let alive = true
    const probe = window.aiOffice.getOllamaModelInfo
    if (!probe) return
    void Promise.all(models.map((m) => probe(baseUrl, m, apiKey))).then(
      (infos) => {
        if (!alive) return
        const map: Record<string, OllamaModelInfo> = {}
        models.forEach((m, i) => {
          map[m] = infos[i]!
        })
        setModelInfo(map)
      },
      () => {},
    )
    return () => {
      alive = false
    }
  }, [catalog, baseUrl, apiKey])
  const current =
    catalog?.baseUrl === server.baseUrl && catalog.apiKey === server.apiKey ? catalog : null
  const status = current?.status ?? 'loading'
  const locked = status === 'ok' && isLocalOllamaUrl(server.baseUrl)
  const timeoutMs = server.connectTimeoutMs ?? OLLAMA_CONNECT_TIMEOUT_MS
  const commitTimeout = () => {
    const draft = timeoutDraft
    setTimeoutDraft(null)
    if (draft === null) return
    const minutes = Math.round(Number(draft))
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 10) return
    const ms = minutes * 60_000
    if (ms === timeoutMs) return
    void change((latest) => {
      // A server removed in another window must not be recreated by a stale card.
      if (!latest.ollamaServers?.some((s) => s.id === server.id)) return latest
      return saveOllamaServer(latest, { ...server, connectTimeoutMs: ms })
    })
  }
  const endpoints = (settings.customEndpoints ?? []).filter((e) =>
    server.endpointIds.includes(e.id),
  )

  const toggleEffort = (model: string, level: OllamaEffortPreset, registered: boolean) => {
    if (registered) return
    setSelectedEfforts((prev) => {
      const currentList = prev[model] ?? ['medium']
      const nextList = currentList.includes(level)
        ? currentList.filter((l) => l !== level)
        : [...currentList, level]
      return { ...prev, [model]: nextList }
    })
  }

  return (
    <article className="ollama-card" aria-label={server.name}>
      <header className="ollama-card-header">
        <div className="ollama-server-heading">
          <button
            className="ollama-name"
            title={t('editServer')}
            disabled={busy}
            onClick={() => setEditing(!editing)}
          >
            {server.name}
          </button>
          <div className="ollama-url">{server.baseUrl}</div>
          <label className="ollama-timeout" title={t('connectTimeoutHint')}>
            <span>{t('connectTimeout')}</span>
            <input
              type="number"
              min={1}
              max={10}
              step={1}
              disabled={busy}
              value={timeoutDraft ?? String(Math.round(timeoutMs / 60_000))}
              onChange={(event) => setTimeoutDraft(event.target.value)}
              onBlur={commitTimeout}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
            />
          </label>
        </div>
        <div className="set-btn-row">
          <button
            className="set-btn"
            disabled={busy || status === 'loading'}
            title={t('refresh')}
            onClick={() => setRefresh((value) => value + 1)}
          >
            {common(status === 'loading' ? 'setAiTesting' : 'setAiTest')}
          </button>
          <button
            className="set-btn danger"
            disabled={busy || locked}
            title={locked ? t('localLocked') : undefined}
            onClick={() => setConfirmDelete(true)}
          >
            {common('delete')}
          </button>
        </div>
      </header>
      {editing && (
        <ServerForm
          server={server}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={async (updated) => {
            const saved = await change((latest) => {
              // A server removed in another window must not be recreated by an old form.
              if (!latest.ollamaServers?.some((s) => s.id === server.id)) return latest
              return saveOllamaServer(latest, updated)
            })
            if (saved) setEditing(false)
            return saved
          }}
        />
      )}
      {confirmDelete && (
        <div className="ollama-confirm">
          <p>{t('removeConfirm')}</p>
          <div className="set-btn-row">
            <button className="set-btn" disabled={busy} onClick={() => setConfirmDelete(false)}>
              {common('cancel')}
            </button>
            <button
              className="set-btn danger"
              disabled={busy}
              onClick={() => void change((latest) => removeOllamaServer(latest, server.id))}
            >
              {common('delete')}
            </button>
          </div>
        </div>
      )}
      <p className={`ollama-status ${status}`} role="status">
        <span
          className={`set-status-dot ${status === 'ok' ? 'running' : status}`}
          aria-hidden="true"
        />
        {status === 'error'
          ? t('connectFailed')
          : common(status === 'ok' ? 'setAiTestOk' : 'setAiTesting')}
      </p>
      <div className="ollama-model-columns">
        <section>
          <h4>{t('installed')}</h4>
          {status === 'ok' && current?.models.length === 0 && <p>{t('noModels')}</p>}
          <ul className="ollama-models">
            {(current?.models ?? []).map((model) => {
              const modelEndpoints = endpoints.filter((e) => e.model === model)
              const registeredEfforts = new Set(
                modelEndpoints.map((e) => (e.effort ?? 'medium') as OllamaEffortPreset),
              )
              const allRegistered = EFFORT_LEVELS.every((level) => registeredEfforts.has(level))
              const currentSelected = selectedEfforts[model] ?? ['medium']
              const toRegister = currentSelected.filter((level) => !registeredEfforts.has(level))
              const isRegisteredState = allRegistered || toRegister.length === 0
              const pretty = prettyModelName(model)

              return (
                <li key={model} className="ollama-model-row">
                  <div className="ollama-model-header">
                    <span className="ollama-model-title">
                      {pretty}
                      {modelInfo[model]?.vision === true && (
                        <span className="ollama-vision-badge">{t('visionBadge')}</span>
                      )}
                    </span>
                    {pretty !== model && <span className="ollama-model-raw">{model}</span>}
                  </div>
                  <div className="ollama-model-actions">
                    <div className="ollama-effort-bar" role="group" aria-label={t('installed')}>
                      {EFFORT_LEVELS.map((level) => {
                        const isRegistered = registeredEfforts.has(level)
                        const isChecked = isRegistered || currentSelected.includes(level)
                        return (
                          <button
                            key={level}
                            type="button"
                            className={`ollama-effort-seg${isChecked ? ' on' : ''}${isRegistered ? ' registered' : ''}`}
                            disabled={busy || isRegistered}
                            aria-pressed={isChecked}
                            title={isRegistered ? t('registeredBadge') : undefined}
                            onClick={() => toggleEffort(model, level, isRegistered)}
                          >
                            {level === 'low'
                              ? t('effortLow')
                              : level === 'medium'
                                ? t('effortMedium')
                                : t('effortHigh')}
                          </button>
                        )
                      })}
                    </div>
                    <button
                      className="set-btn"
                      disabled={busy || isRegisteredState || model.length > 256}
                      onClick={() =>
                        void change((latest) => {
                          const live = latest.ollamaServers?.find((s) => s.id === server.id)
                          if (live?.baseUrl !== server.baseUrl || live.apiKey !== server.apiKey)
                            return latest
                          let updated = latest
                          const info = modelInfo[model]
                          const vision =
                            info && info.capabilities.length > 0 ? info.vision : undefined
                          for (const eff of toRegister) {
                            updated = registerOllamaModel(updated, server.id, model, eff, vision)
                          }
                          return updated
                        })
                      }
                    >
                      {t(isRegisteredState ? 'registeredBadge' : 'register')}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
        <section>
          <h4>{t('registered')}</h4>
          {endpoints.length === 0 && <p>{t('noRegistered')}</p>}
          <ul className="ollama-models">
            {endpoints.map((endpoint) => {
              const pretty = prettyModelName(endpoint.model)
              const effort = endpoint.effort ?? 'medium'
              const label = endpoint.name || `${pretty} ${effort}`
              return (
                <li key={endpoint.id} className="ollama-registered-row">
                  <div className="ollama-registered-info">
                    <span className="ollama-registered-title">
                      {label}
                      {endpoint.vision === true && (
                        <span className="ollama-vision-badge">{t('visionBadge')}</span>
                      )}
                    </span>
                    <span className="ollama-model-raw">{endpoint.model}</span>
                  </div>
                  <button
                    className="set-btn"
                    disabled={busy}
                    onClick={() =>
                      void change((latest) => unregisterOllamaModel(latest, server.id, endpoint.id))
                    }
                  >
                    {common('delete')}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      </div>
    </article>
  )
}

export function OllamaPane() {
  const { lang } = useI18n()
  const t = (key: OllamaStringKey) => ollamaText(lang, key)
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<OllamaStringKey | null>(null)
  const alive = useRef(false)
  const version = useRef(0)
  const load = async () => {
    const request = ++version.current
    const next = await readAiSettings()
    if (!alive.current || request !== version.current) return
    setSettings(next)
    setError(next ? null : 'loadFailed')
  }
  useEffect(() => {
    alive.current = true
    void load()
    const off = window.aiOffice.onAiSettingsChanged?.(() => void load())
    return () => {
      alive.current = false
      off?.()
    }
  }, [])
  const change: Change = async (apply) => {
    setBusy(true)
    setError(null)
    const next = await changeAiSettings((latest) =>
      apply(withDefaultOllamaServer(latest, t('localServer'))),
    )
    if (alive.current) {
      ++version.current
      if (next) setSettings(next)
      else setError('saveFailed')
      setBusy(false)
    }
    return next !== null
  }
  const restored = useRef(false)
  useEffect(() => {
    const list = settings?.ollamaServers
    if (!list || restored.current) return
    if (list.some((s) => s.baseUrl === LOCAL_OLLAMA_URL)) return
    restored.current = true
    void window.aiOffice.getCustomModels(LOCAL_OLLAMA_URL, '').then(
      (result) => {
        if (!alive.current || !(result.reachable || result.models.length > 0)) return
        void change((latest) => {
          const current = latest.ollamaServers ?? []
          if (current.some((s) => s.baseUrl === LOCAL_OLLAMA_URL)) return latest
          return saveOllamaServer(latest, defaultOllamaServer(t('localServer')))
        })
      },
      () => {},
    )
  }, [settings])
  const servers = settings
    ? (withDefaultOllamaServer(settings, t('localServer')).ollamaServers ?? [])
    : []
  return (
    <div className="ollama-pane">
      <div className="ollama-card-header">
        <h3 className="set-pane-title">{t('title')}</h3>
        <button
          className="set-btn primary"
          disabled={!settings || busy || adding || servers.length >= 100}
          onClick={() => setAdding(true)}
        >
          + {t('addServer')}
        </button>
      </div>
      <p className="set-field-desc">{t('description')}</p>
      {error && (
        <p className="ollama-error" role="alert">
          {t(error)}
        </p>
      )}
      {!settings && (
        <button className="set-btn" onClick={() => void load()}>
          {t(error ? 'retry' : 'loading')}
        </button>
      )}
      {adding && (
        <ServerForm
          busy={busy}
          onCancel={() => setAdding(false)}
          onSave={async (server) => {
            const saved = await change((latest) => saveOllamaServer(latest, server))
            if (saved && alive.current) setAdding(false)
            return saved
          }}
        />
      )}
      {settings && servers.length === 0 && <p className="ollama-empty">{t('empty')}</p>}
      {settings &&
        servers.map((server) => (
          <ServerCard
            key={server.id}
            server={server}
            settings={settings}
            busy={busy}
            change={change}
          />
        ))}
    </div>
  )
}
