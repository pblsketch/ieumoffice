/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultAiSettings, sanitizeAiSettings } from '@genoffice/ai-provider'
import {
  checkingSubscriptionStatuses,
  normalizeAiSettings,
  selectCustomEndpoint,
  upsertCustomEndpoint,
  type AiOllamaServer,
  type AiSettings,
  type CodexModelCatalog,
} from '@genoffice/ai-provider/browser'
import { aiProviderPickerGroups, withAiModelSelection } from '@genoffice/ui'
import { aiSelectionChoices, withAiSelection } from '../src/renderer/src/settings-ai'
import {
  registerOllamaModel,
  removeOllamaServer,
  saveOllamaServer,
  unregisterOllamaModel,
} from '../src/renderer/src/ollama-settings'
import { OllamaPane } from '../src/renderer/src/OllamaPane'
import { LocaleProvider } from '../src/renderer/src/locale'
import type { HomeApi } from '../src/shared/home-api'

const server: AiOllamaServer = {
  id: 'local',
  name: 'Local',
  baseUrl: 'http://localhost:11434/v1',
  apiKey: '',
  endpointIds: [],
}
const other: AiOllamaServer = {
  ...server,
  id: 'lan',
  name: 'LAN',
  baseUrl: 'http://192.168.1.10:11434/v1',
}

describe('Ollama models in the shared Custom catalogue', () => {
  it('lists both servers in both pickers and preserves the active Custom endpoint on registration', () => {
    let settings = upsertCustomEndpoint(defaultAiSettings(), {
      id: 'existing',
      name: 'Existing',
      baseUrl: 'http://localhost:8000/v1',
      apiKey: 'key',
      model: 'old',
    })
    settings.provider = 'custom'
    settings = saveOllamaServer(saveOllamaServer(settings, server), other)
    settings = registerOllamaModel(
      registerOllamaModel(settings, server.id, 'qwen'),
      other.id,
      'qwen',
    )
    settings = normalizeAiSettings(sanitizeAiSettings(settings))
    expect(settings.customEndpoint).toBe('existing')
    expect(settings.providers.custom.model).toBe('old')
    expect(settings.customEndpoints).toHaveLength(3)
    expect(registerOllamaModel(settings, server.id, 'qwen').customEndpoints).toHaveLength(3)
    const statuses = checkingSubscriptionStatuses()
    const choices = aiSelectionChoices(settings, statuses)
    expect(choices.map((c) => c.name)).toEqual([
      undefined,
      'Local / qwen',
      'LAN / qwen',
      'Existing',
    ])
    const selected = withAiSelection(settings, choices[2]!)
    expect(selected.providers.custom.baseUrl).toBe(other.baseUrl)
    const groups = aiProviderPickerGroups(settings, statuses)
    const local = groups.find((g) => g.label === 'Local / qwen')!
    expect(local.models).toEqual(['qwen'])
    const documentSelection = withAiModelSelection(settings, {
      provider: 'custom',
      endpoint: local.endpoint,
      model: 'qwen',
    })
    expect(documentSelection.providers.custom).toEqual({
      baseUrl: server.baseUrl,
      apiKey: '',
      model: 'qwen',
      connectTimeoutMs: 300_000,
    })
    expect(documentSelection.ollamaServers).toEqual(settings.ollamaServers)
  })

  it('updates all owned models and the active slot, without changing other servers', () => {
    let settings = saveOllamaServer(saveOllamaServer(defaultAiSettings(), server), other)
    settings = registerOllamaModel(settings, server.id, 'one')
    settings = registerOllamaModel(settings, server.id, 'two')
    settings = registerOllamaModel(settings, other.id, 'one')
    const first = settings.customEndpoints![0]!
    settings = selectCustomEndpoint(settings, first.id)
    settings = upsertCustomEndpoint(settings, {
      ...settings.customEndpoints![1]!,
      name: 'My model',
    })
    settings = saveOllamaServer(settings, {
      ...server,
      name: 'Renamed',
      baseUrl: 'http://localhost:1234/v1',
      apiKey: 'new-key',
    })
    expect(settings.customEndpoints!.map((e) => e.name)).toEqual([
      'Renamed / one',
      'My model',
      'LAN / one',
    ])
    expect(settings.customEndpoints![1]!.apiKey).toBe('new-key')
    expect(settings.providers.custom.baseUrl).toBe('http://localhost:1234/v1')
    expect(settings.customEndpoints![2]!.baseUrl).toBe(other.baseUrl)
    settings = unregisterOllamaModel(settings, server.id, settings.customEndpoints![1]!.id)
    expect(settings.customEndpoints).toHaveLength(2)
    settings = removeOllamaServer(settings, server.id)
    expect(settings.customEndpoints!.map((e) => e.name)).toEqual(['LAN / one'])
    expect(settings.ollamaServers!.map((s) => s.id)).toEqual(['lan'])
    expect(registerOllamaModel(settings, server.id, 'late')).toBe(settings)
  })
})

let host: HTMLDivElement
let root: Root
let stored: AiSettings
let writes: ReturnType<typeof vi.fn>
let pending: Array<{ url: string; key?: string; resolve: (catalog: CodexModelCatalog) => void }>
let visionMap: Record<string, { vision: boolean; capabilities: string[] }>
let changed: (() => void) | undefined

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  stored = { ...defaultAiSettings(), ollamaServers: [] }
  pending = []
  visionMap = {}
  writes = vi.fn(async (next: AiSettings) => {
    stored = normalizeAiSettings(sanitizeAiSettings(next))
  })
  window.aiOffice = {
    getAiSettings: async () => stored,
    setAiSettings: writes,
    getCustomModels: (url: string, key?: string) =>
      new Promise<CodexModelCatalog>((resolve) => pending.push({ url, key, resolve })),
    getOllamaModelInfo: async (_url: string, model: string) =>
      visionMap[model] ?? { vision: false, capabilities: [] },
    onAiSettingsChanged: (listener: () => void) => {
      changed = listener
      return () => {
        changed = undefined
      }
    },
  } as unknown as HomeApi
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})
async function render() {
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(OllamaPane)))
  })
}
function button(text: string, scope: ParentNode = host): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  )
  expect(found, `button: ${text}`).toBeDefined()
  return found!
}
async function click(text: string, scope: ParentNode = host) {
  await act(async () => {
    button(text, scope).click()
  })
}
async function type(index: number, value: string) {
  const input = host.querySelectorAll<HTMLInputElement>('form input')[index]!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function answer(index: number, models: string[], reachable = true) {
  await act(async () => {
    pending[index]!.resolve({ models, defaultModel: '', reachable })
  })
}

describe('Ollama settings pane', () => {
  it('shows and probes the local server by default, saves on registration and respects deletion', async () => {
    stored = defaultAiSettings()
    await render()
    expect(host.textContent).toContain('Local Ollama')
    expect(pending).toHaveLength(1)
    expect(pending[0]!.url).toBe(server.baseUrl)
    expect(writes).not.toHaveBeenCalled()
    await answer(0, ['qwen'])
    await click('Register')
    expect(stored.ollamaServers?.[0]).toMatchObject({
      id: 'ollama-local',
      baseUrl: server.baseUrl,
    })
    expect(stored.customEndpoints?.[0]?.name).toBe('Local Ollama / Qwen medium')
    expect(stored.customEndpoints?.[0]?.connectTimeoutMs).toBe(300_000)
    const header = host.querySelector('article header')!
    expect(button('Delete', header).disabled).toBe(true)
    await click('Test connection')
    await answer(1, [], false)
    await click('Delete', header)
    await click('Delete', host.querySelector('.ollama-confirm')!)
    await act(async () => {
      changed?.()
    })
    expect(stored.ollamaServers).toEqual([])
    expect(host.querySelector('article')).toBeNull()
    expect(host.textContent).toContain('No servers added yet.')
  })

  it('adds, edits, registers, removes and reloads a server through the persisted settings API', async () => {
    await render()
    expect(host.textContent).toContain('No servers added yet.')
    await answer(0, [], false)
    await click('+ Add server')
    await type(0, 'Local')
    await click('Add server')
    expect(pending).toHaveLength(2)
    expect(pending[1]!.url).toBe(server.baseUrl)
    expect(stored.ollamaServers).toHaveLength(1)
    expect(stored.customEndpoints).toBeUndefined()
    await answer(1, ['qwen'])
    await click('Register')
    expect(button('Registered').disabled).toBe(true)
    expect(stored.provider).toBe('auto')
    expect(stored.customEndpoints![0]!.name).toBe('Local / Qwen medium')
    await click('Local')
    await type(0, 'Office')
    await type(1, other.baseUrl)
    await type(2, 'secret')
    await type(3, '7')
    await click('Save')
    expect(pending[2]).toMatchObject({ url: other.baseUrl, key: 'secret' })
    expect(stored.customEndpoints![0]).toMatchObject({
      name: 'Office / Qwen medium',
      baseUrl: other.baseUrl,
      apiKey: 'secret',
      connectTimeoutMs: 420_000,
    })
    await act(async () => {
      changed?.()
    })
    expect(host.textContent).toContain('Office / Qwen medium')
    await click('Delete', host.querySelectorAll('.ollama-model-columns section')[1]!)
    expect(stored.customEndpoints).toBeUndefined()
    await click('Delete', host.querySelector('article header')!)
    await click('Cancel', host.querySelector('.ollama-confirm')!)
    expect(stored.ollamaServers).toHaveLength(1)
    await click('Delete', host.querySelector('article header')!)
    await click('Delete', host.querySelector('.ollama-confirm')!)
    expect(stored.ollamaServers).toEqual([])
    await answer(2, ['late'])
    expect(host.textContent).not.toContain('late')
  })

  it('discards old replies after URL changes and distinguishes an empty server from failure', async () => {
    stored = saveOllamaServer(defaultAiSettings(), server)
    await render()
    await click('Local')
    await type(1, 'file:///wrong')
    expect(button('Save').disabled).toBe(true)
    await type(1, other.baseUrl)
    await click('Save')
    await answer(1, [])
    expect(host.textContent).toContain('Connection OK')
    expect(host.textContent).toContain('No models are installed')
    await answer(0, ['old-server-model'])
    expect(host.textContent).not.toContain('old-server-model')
    await answer(2, [], false)
    await click('Test connection')
    await answer(3, [], false)
    expect(host.textContent).toContain('Could not fetch models.')
    await click('Test connection')
    await answer(4, ['recovered'])
    expect(host.textContent).toContain('recovered')
  })

  it('keeps failed saves visible and never probes an unsaved server', async () => {
    writes.mockRejectedValueOnce(new Error('disk full'))
    await render()
    await answer(0, [], false)
    await click('+ Add server')
    await type(0, 'Local')
    await click('Add server')
    expect(host.textContent).toContain('Could not save changes.')
    expect(host.querySelector('form')).not.toBeNull()
    expect(pending).toHaveLength(1)
    await click('Add server')
    expect(stored.ollamaServers).toHaveLength(1)
    expect(pending).toHaveLength(2)
  })

  it('locks deletion of a reachable local server but not of a remote one', async () => {
    stored = saveOllamaServer(saveOllamaServer(defaultAiSettings(), server), other)
    await render()
    await answer(0, ['qwen'])
    await answer(1, ['remote-model'])
    const cards = host.querySelectorAll('article')
    expect(button('Delete', cards[0]!.querySelector('header')!).disabled).toBe(true)
    await click('Delete', cards[1]!.querySelector('header')!)
    await click('Delete', cards[1]!.querySelector('.ollama-confirm')!)
    expect(stored.ollamaServers?.map((s) => s.id)).toEqual(['local'])
    expect(host.textContent).toContain('Local')
    expect(host.textContent).not.toContain('LAN')
  })

  it('shows a vision badge on models that take images and stores it on registration', async () => {
    stored = saveOllamaServer(defaultAiSettings(), server)
    visionMap.qwen = { vision: true, capabilities: ['completion', 'vision'] }
    visionMap.texto = { vision: false, capabilities: ['completion'] }
    await render()
    await answer(0, ['qwen', 'texto'])
    await act(async () => {})
    const rows = host.querySelectorAll('li.ollama-model-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.querySelector('.ollama-vision-badge')).not.toBeNull()
    expect(rows[1]!.querySelector('.ollama-vision-badge')).toBeNull()
    await click('Register', rows[0]!)
    expect(stored.customEndpoints?.[0]?.vision).toBe(true)
    await click('Register', rows[1]!)
    expect(stored.customEndpoints?.[1]?.vision).toBe(false)
    const registered = host.querySelectorAll('li.ollama-registered-row')
    expect(registered[0]!.querySelector('.ollama-vision-badge')).not.toBeNull()
    expect(registered[1]!.querySelector('.ollama-vision-badge')).toBeNull()
  })

  it('restores the local card when a running local Ollama answers', async () => {
    await render()
    expect(host.textContent).toContain('No servers added yet.')
    await answer(0, ['qwen'])
    expect(stored.ollamaServers).toEqual([
      expect.objectContaining({ id: 'ollama-local', baseUrl: server.baseUrl }),
    ])
    expect(host.textContent).toContain('Local Ollama')
    await answer(1, ['qwen'])
    expect(host.textContent).toContain('Qwen')
  })
})
