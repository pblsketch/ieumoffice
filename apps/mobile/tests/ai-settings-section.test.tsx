// The settings' AI section (track T7 AI-T6, spec 3.5): the AI switch's hint
// and "stop and turn off?", the self-hosted server row, and the AI tool
// switches. Everything runs on a scripted Rust; no network, no real key.
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AI_MEDIA_PROVIDERS } from '@genoffice/ai-provider/browser'
import type {
  MobileAiSettingsSnapshot,
  MobileAppPrefs,
  MobileAppPrefsPatch,
} from '@genoffice/mobile-bridge/transport'
import {
  publishMobileAiRunState,
  registerMobileAiStopAll,
  stopAllMobileAi,
} from '../src/renderer/ai/runState'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { ko } from '../src/renderer/i18n/ko'
import { ko as aiKo } from '../src/renderer/i18n/ai/ko'
import { SettingsScreen } from '../src/renderer/settings/SettingsScreen'
import { BackStackProvider } from '../src/renderer/shell/backStack'
import {
  EMPTY_SNAPSHOT,
  TOOLS_DEFAULT,
  byTestId,
  choose,
  click,
  commandsNamed,
  headerOf,
  makeSettingsFake,
  mountSettings,
  settle,
  typeInto,
  unmountAll,
} from './ai-settings-fake'

const bareRoots: Root[] = []

afterEach(() => {
  for (const root of bareRoots.splice(0)) act(() => root.unmount())
  unmountAll()
  publishMobileAiRunState({ running: false, queued: 0 })
})

const toggle = () => byTestId<HTMLInputElement>('settings-ai-enabled-toggle')!

/** The settings screen alone (no useMobileAi): the run state comes from the module store. */
async function mountBare(): Promise<{
  prefs: () => MobileAppPrefs
  updates: MobileAppPrefsPatch[]
}> {
  const holder: { prefs: MobileAppPrefs | null } = { prefs: null }
  const updates: MobileAppPrefsPatch[] = []
  function Bare() {
    const [prefs, setPrefs] = useState<MobileAppPrefs>({
      lang: 'ko',
      theme: 'system',
      hwpDefaultFormat: 'hwp',
      aiEnabled: true,
    })
    holder.prefs = prefs
    return (
      <SettingsScreen
        prefs={prefs}
        aiSettings={EMPTY_SNAPSHOT}
        chatgptStatus={{ state: 'hidden' }}
        backups={[]}
        onBack={() => {}}
        onUpdatePrefs={(patch) => {
          updates.push(patch)
          setPrefs((prev) => ({ ...prev, ...patch }))
        }}
        onSelectProvider={() => {}}
        onValidateAndSaveKey={async () => {}}
        onRemoveKey={async () => {}}
        onChatgptSignIn={async () => {}}
        onChatgptSignOut={async () => {}}
        onRestoreBackup={async () => {}}
        onDeleteBackup={async () => {}}
      />
    )
  }
  const div = document.createElement('div')
  document.body.appendChild(div)
  const root = createRoot(div)
  bareRoots.push(root)
  await act(async () => {
    root.render(
      <MobileLocaleProvider lang="ko">
        <BackStackProvider>
          <Bare />
        </BackStackProvider>
      </MobileLocaleProvider>,
    )
  })
  return { prefs: () => holder.prefs!, updates }
}

describe('the AI switch', () => {
  it('shows the one-line hint under the switch', async () => {
    await mountBare()
    const hint = byTestId('ai-enabled-hint')
    expect(hint?.textContent).toBe(aiKo.aiEnabledHint)
    expect(toggle().closest('.mobile-set-row')?.contains(hint)).toBe(true)
  })

  it('turns off at once when no AI work is going', async () => {
    const view = await mountBare()
    await click(toggle())
    expect(view.prefs().aiEnabled).toBe(false)
    expect(byTestId('ai-stop-off-sheet')).toBeNull()
  })

  it('asks "stop and turn off?" while a run is going; confirming stops and saves off', async () => {
    const stop = vi.fn(() => publishMobileAiRunState({ running: false, queued: 0 }))
    const unregister = registerMobileAiStopAll(stop)
    try {
      const view = await mountBare()
      act(() => publishMobileAiRunState({ running: true, queued: 0 }))
      await click(toggle())
      expect(byTestId('ai-stop-off-sheet')?.textContent).toContain(aiKo.aiStopOffTitle)
      expect(view.prefs().aiEnabled).toBe(true)
      expect(toggle().checked).toBe(true)

      await click(byTestId('ai-stop-off-confirm'))
      expect(stop).toHaveBeenCalledTimes(1)
      expect(view.updates).toEqual([{ aiEnabled: false }])
      expect(view.prefs().aiEnabled).toBe(false)
      expect(byTestId('ai-stop-off-sheet')).toBeNull()
    } finally {
      unregister()
    }
  })

  it('asks too when only queued messages wait', async () => {
    const view = await mountBare()
    act(() => publishMobileAiRunState({ running: false, queued: 2 }))
    await click(toggle())
    expect(byTestId('ai-stop-off-sheet')).not.toBeNull()
    expect(view.prefs().aiEnabled).toBe(true)
  })

  it('cancel and Back keep AI on and stop nothing', async () => {
    const stop = vi.fn()
    const unregister = registerMobileAiStopAll(stop)
    try {
      const view = await mountBare()
      act(() => publishMobileAiRunState({ running: true, queued: 1 }))
      await click(toggle())
      await click(byTestId('ai-stop-off-cancel'))
      expect(byTestId('ai-stop-off-sheet')).toBeNull()
      expect(view.prefs().aiEnabled).toBe(true)
      expect(toggle().checked).toBe(true)

      await click(toggle())
      expect(byTestId('ai-stop-off-sheet')).not.toBeNull()
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      })
      expect(byTestId('ai-stop-off-sheet')).toBeNull()
      expect(view.prefs().aiEnabled).toBe(true)
      expect(stop).not.toHaveBeenCalled()
      expect(view.updates).toEqual([])
    } finally {
      unregister()
      stopAllMobileAi()
    }
  })

  it('turning on is unchanged', async () => {
    const view = await mountBare()
    await click(toggle())
    await click(toggle())
    expect(view.prefs().aiEnabled).toBe(true)
  })
})

const BASE = 'https://ai.home.example/v1'

async function openCustom() {
  await click(byTestId('ai-custom-trigger'))
}

describe('the self-hosted server row', () => {
  it('refuses an http address with the reason and saves nothing', async () => {
    const fake = makeSettingsFake()
    await mountSettings(fake)
    await openCustom()
    await typeInto(byTestId('ai-custom-url'), 'http://ai.home.example/v1')
    await click(byTestId('ai-custom-save'))
    expect(byTestId('ai-custom-reason')?.textContent).toBe(aiKo.aiCustomHttpsOnly)
    expect(fake.endpoint.baseUrl).toBeNull()
    expect(fake.relayStarts).toHaveLength(0)
    expect(commandsNamed(fake, 'mobile_set_ai_settings')).toHaveLength(0)
  })

  it('refuses a malformed address', async () => {
    const fake = makeSettingsFake()
    await mountSettings(fake)
    await openCustom()
    await typeInto(byTestId('ai-custom-url'), 'not a url')
    await click(byTestId('ai-custom-save'))
    expect(byTestId('ai-custom-reason')?.textContent).toBe(aiKo.aiCustomInvalidUrl)
    expect(fake.endpoint.baseUrl).toBeNull()
  })

  it('saves https, lists models through the relay with the placeholder, selects the server', async () => {
    const fake = makeSettingsFake({
      relay: () => ({
        status: 200,
        body: JSON.stringify({ data: [{ id: 'llama-local' }, { id: 'qwen-local' }] }),
      }),
    })
    await mountSettings(fake)
    await openCustom()
    await typeInto(byTestId('ai-custom-url'), BASE)
    await typeInto(byTestId('ai-custom-key'), 'sk-home-secret')
    expect(byTestId<HTMLInputElement>('ai-custom-key')?.type).toBe('password')
    await click(byTestId('ai-custom-save'))
    await settle()

    // the endpoint is saved before the list is read, so the relay allows its host
    const order = fake.commands.map((c) => c.command)
    expect(order.indexOf('mobile_ai_set_custom_endpoint')).toBeLessThan(
      order.indexOf('mobile_ai_relay_start'),
    )
    expect(fake.relayStarts).toHaveLength(1)
    const start = fake.relayStarts[0]!
    expect(start.url).toBe(`${BASE}/models`)
    expect(start.method).toBe('GET')
    expect(headerOf(start, 'authorization')).toBe('Bearer __sealed__:custom')
    expect(JSON.stringify(fake.relayStarts)).not.toContain('sk-home-secret')

    expect(fake.endpoint.model).toBe('llama-local')
    expect(fake.endpoint.models).toEqual(['llama-local', 'qwen-local'])
    expect(fake.snapshot.selectedProvider).toBe('custom')

    // connected: host and model shown, the key never
    expect(byTestId('ai-custom-host')?.textContent).toContain('ai.home.example')
    expect(byTestId('ai-custom-model-select')).not.toBeNull()
    expect(document.body.textContent).not.toContain('sk-home-secret')
    expect(byTestId('ai-custom-url')).toBeNull()
  })

  it('sends no auth header when no key is given', async () => {
    const fake = makeSettingsFake({
      relay: () => ({ status: 200, body: JSON.stringify({ data: [{ id: 'm1' }] }) }),
    })
    await mountSettings(fake)
    await openCustom()
    await typeInto(byTestId('ai-custom-url'), BASE)
    await click(byTestId('ai-custom-save'))
    await settle()
    expect(headerOf(fake.relayStarts[0]!, 'authorization')).toBeUndefined()
    expect(fake.snapshot.selectedProvider).toBe('custom')
  })

  it('keeps the endpoint when the list fails and takes a typed model', async () => {
    const fake = makeSettingsFake({
      relay: () => ({ fail: { code: 'NETWORK_ERROR', messageKey: 'mobile.ai.networkError' } }),
    })
    await mountSettings(fake)
    await openCustom()
    await typeInto(byTestId('ai-custom-url'), BASE)
    await click(byTestId('ai-custom-save'))
    await settle()

    expect(fake.endpoint.baseUrl).toBe(BASE)
    expect(fake.snapshot.selectedProvider).toBe('auto')
    expect(byTestId('ai-custom-list-failed')?.textContent).toBe(aiKo.aiCustomListFailed)
    expect(byTestId<HTMLButtonElement>('ai-custom-use')?.disabled).toBe(true)

    await typeInto(byTestId('ai-custom-model-input'), 'my-model')
    await click(byTestId('ai-custom-model-save'))
    await settle()
    expect(fake.endpoint.model).toBe('my-model')
    expect(fake.snapshot.selectedProvider).toBe('custom')
    expect(byTestId('ai-custom-model')?.textContent).toContain('my-model')
  })

  it('treats a non-JSON or empty list as a failure', async () => {
    const fake = makeSettingsFake({ relay: () => ({ status: 404, body: 'not here' }) })
    await mountSettings(fake)
    await openCustom()
    await typeInto(byTestId('ai-custom-url'), BASE)
    await click(byTestId('ai-custom-save'))
    await settle()
    expect(fake.endpoint.baseUrl).toBe(BASE)
    expect(byTestId('ai-custom-model-input')).not.toBeNull()
  })

  it('selects a saved server with [use] and forgets it with [clear]', async () => {
    const fake = makeSettingsFake({
      endpoint: { baseUrl: `${BASE}`, key: 'kept-secret', model: 'm1', models: ['m1', 'm2'] },
      snapshot: {
        ...EMPTY_SNAPSHOT,
        configuredProviders: { custom: { hasKey: true, models: ['m1', 'm2'] } },
        modelByProvider: { custom: 'm1' },
      } satisfies MobileAiSettingsSnapshot,
    })
    await mountSettings(fake)
    await openCustom()
    expect(byTestId('ai-custom-host')?.textContent).toContain('ai.home.example')
    expect(document.body.textContent).not.toContain('kept-secret')

    await choose(byTestId('ai-custom-model-select'), 'm2')
    expect(fake.endpoint.model).toBe('m2')

    await click(byTestId('ai-custom-use'))
    expect(fake.snapshot.selectedProvider).toBe('custom')

    await click(byTestId('ai-custom-clear'))
    expect(commandsNamed(fake, 'mobile_ai_clear_custom_endpoint')).toHaveLength(1)
    expect(fake.endpoint.baseUrl).toBeNull()
    expect(fake.snapshot.selectedProvider).toBe('auto')
    expect(byTestId('ai-custom-url')).not.toBeNull()
  })

  it('is not drawn while AI is off', async () => {
    const fake = makeSettingsFake()
    await mountSettings(fake, { aiEnabled: false })
    expect(byTestId('ai-custom-server')).toBeNull()
    expect(byTestId('ai-tools-card')).toBeNull()
  })
})

const openaiMeta = AI_MEDIA_PROVIDERS.find((m) => m.id === 'openai')!
const geminiMeta = AI_MEDIA_PROVIDERS.find((m) => m.id === 'gemini')!

describe('the AI tool switches', () => {
  it('shows the internet switch on by default and saves turning it off', async () => {
    const fake = makeSettingsFake()
    await mountSettings(fake)
    const internet = byTestId<HTMLInputElement>('ai-tools-internet-toggle')!
    expect(internet.checked).toBe(true)
    await click(internet)
    expect(commandsNamed(fake, 'mobile_ai_set_tool_settings').at(-1)?.args).toEqual({
      internetTools: false,
    })
    expect(fake.toolSettings.internetTools).toBe(false)
    expect(byTestId<HTMLInputElement>('ai-tools-internet-toggle')!.checked).toBe(false)
  })

  it('keeps picture making off and disabled, with the reason, when no image provider is ready', async () => {
    const fake = makeSettingsFake()
    await mountSettings(fake)
    const image = byTestId<HTMLInputElement>('ai-tools-image-toggle')!
    expect(image.checked).toBe(false)
    expect(image.disabled).toBe(true)
    expect(byTestId('ai-tools-image-unavailable')?.textContent).toBe(aiKo.aiToolsImageNoProvider)
    await click(image)
    expect(commandsNamed(fake, 'mobile_ai_set_tool_settings')).toHaveLength(0)
  })

  it('turns picture making on with the chosen provider and a catalog model', async () => {
    const fake = makeSettingsFake({
      toolSettings: { ...TOOLS_DEFAULT, imageProvidersReady: ['gemini', 'openai'] },
    })
    await mountSettings(fake)
    const providers = [
      ...byTestId<HTMLSelectElement>('ai-tools-image-provider')!.querySelectorAll('option'),
    ].map((o) => o.value)
    expect(providers).toEqual(['gemini', 'openai'])
    expect(providers).not.toContain('openrouter')

    await choose(byTestId('ai-tools-image-provider'), 'openai')
    const models = [
      ...byTestId<HTMLSelectElement>('ai-tools-image-model')!.querySelectorAll('option'),
    ].map((o) => o.value)
    expect(models).toEqual(openaiMeta.imageModels)
    const pick = openaiMeta.imageModels[1]!
    await choose(byTestId('ai-tools-image-model'), pick)
    // choosing alone turns nothing on
    expect(commandsNamed(fake, 'mobile_ai_set_tool_settings')).toHaveLength(0)

    await click(byTestId('ai-tools-image-toggle'))
    expect(commandsNamed(fake, 'mobile_ai_set_tool_settings').at(-1)?.args).toEqual({
      imageGeneration: true,
      imageProvider: 'openai',
      imageModel: pick,
    })
    expect(fake.toolSettings.imageGeneration).toBe(true)
    expect(byTestId<HTMLInputElement>('ai-tools-image-toggle')!.checked).toBe(true)

    // turning it off again saves only the switch
    await click(byTestId('ai-tools-image-toggle'))
    expect(commandsNamed(fake, 'mobile_ai_set_tool_settings').at(-1)?.args).toEqual({
      imageGeneration: false,
    })
  })

  it('starts from the saved provider and model', async () => {
    const saved = geminiMeta.imageModels[2]!
    const fake = makeSettingsFake({
      toolSettings: {
        ...TOOLS_DEFAULT,
        imageGeneration: true,
        imageProvider: 'gemini',
        imageModel: saved,
        imageProvidersReady: ['gemini'],
      },
    })
    await mountSettings(fake)
    expect(byTestId<HTMLSelectElement>('ai-tools-image-provider')!.value).toBe('gemini')
    expect(byTestId<HTMLSelectElement>('ai-tools-image-model')!.value).toBe(saved)
    expect(byTestId<HTMLInputElement>('ai-tools-image-toggle')!.checked).toBe(true)

    // while on, another model is saved at once
    const other = geminiMeta.imageModels[0]!
    await choose(byTestId('ai-tools-image-model'), other)
    expect(commandsNamed(fake, 'mobile_ai_set_tool_settings').at(-1)?.args).toEqual({
      imageProvider: 'gemini',
      imageModel: other,
    })
    expect(fake.toolSettings.imageModel).toBe(other)
  })

  it("shows Rust's refusal as a reason and stays off", async () => {
    const fake = makeSettingsFake({
      // the key went away after the list was read: Rust refuses
      toolSettings: { ...TOOLS_DEFAULT, imageProvidersReady: ['openai'] },
    })
    await mountSettings(fake)
    fake.toolSettings = { ...fake.toolSettings, imageProvidersReady: [] }
    await click(byTestId('ai-tools-image-toggle'))
    expect(byTestId('ai-tools-reason')?.textContent).toBe(aiKo.aiToolsErrProviderNoKey)
    expect(fake.toolSettings.imageGeneration).toBe(false)
    expect(byTestId<HTMLInputElement>('ai-tools-image-toggle')!.checked).toBe(false)
  })

  it('uses the base dictionary only for its own existing keys', () => {
    // the new keys must not shadow the base dictionary
    for (const key of Object.keys(aiKo)) expect(Object.keys(ko)).not.toContain(key)
  })
})
