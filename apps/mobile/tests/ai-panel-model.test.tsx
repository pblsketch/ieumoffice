import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { OPENROUTER_FREE_MODELS } from '@genoffice/ai-provider/browser'
import { preloadMobileKeyProviderProtocols } from '@genoffice/mobile-bridge/ai-bridge'
import { mobileModelGroups } from '../src/renderer/ai/modelChoice'
import {
  FREE_MODEL,
  byTestId,
  click,
  freeOpenRouter,
  keyProvider,
  makeFakeAiRust,
  mountAi,
  relayJson,
  settle,
  typeAndSend,
  unmountAll,
  waitFor,
} from './ai-panel-fake'

// The model chip and model sheet of the AI panel (spec 3.4): PC's
// keyProviderModels list per connected provider, an OpenRouter free
// connection lists `:free` models only, choosing saves the provider and
// model, and nothing can be chosen while a run is going.

beforeAll(async () => {
  await preloadMobileKeyProviderProtocols()
}, 60_000)

afterEach(() => unmountAll())

const options = () =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-testid="ai-model-option"]')].map(
    (b) => b.dataset.model ?? '',
  )

describe('the model list', () => {
  it('lists only free models for an OpenRouter free connection, tested ones first', () => {
    const groups = mobileModelGroups(
      freeOpenRouter(FREE_MODEL, ['openai/gpt-5.6-mini', 'some/new-model:free', FREE_MODEL]),
    )
    expect(groups).toHaveLength(1)
    const models = groups[0]!.models
    expect(models.length).toBeGreaterThan(0)
    expect(models.every((m) => m.endsWith(':free'))).toBe(true)
    expect(models).not.toContain('openai/gpt-5.6-mini')
    expect(OPENROUTER_FREE_MODELS).toContain(models[0])
    expect(groups[0]!.free).toBe(true)
  })

  it('stays free-only even when the stored model is missing or paid', () => {
    const snapshot = { ...freeOpenRouter(), modelByProvider: { openrouter: 'openai/gpt-5' } }
    const models = mobileModelGroups(snapshot)[0]!.models
    expect(models.every((m) => m.endsWith(':free'))).toBe(true)
  })

  it('lists every connected provider and the self-hosted server with its saved models', () => {
    const groups = mobileModelGroups({
      selectedProvider: 'anthropic',
      modelByProvider: { anthropic: 'claude-sonnet-4-5', custom: 'llama-local' },
      configuredProviders: {
        anthropic: { hasKey: true, models: [] },
        custom: { hasKey: false, models: ['llama-local', 'qwen-local'] },
        openai: { hasKey: false, models: [] },
      },
      chatgptVisible: false,
      subscriptionNoticeVersion: 0,
    })
    expect(groups.map((g) => g.provider)).toEqual(['anthropic', 'custom'])
    expect(groups[0]!.models).toContain('claude-sonnet-4-5')
    expect(groups[1]!.models).toEqual(['llama-local', 'qwen-local'])
  })
})

describe('the model chip and sheet', () => {
  it('shows the model in use and lists the free models in the sheet', async () => {
    const rust = makeFakeAiRust({
      snapshot: freeOpenRouter(FREE_MODEL, ['openai/gpt-5.6-mini', FREE_MODEL]),
    })
    await mountAi(rust)
    const chip = byTestId('ai-model-chip')
    expect(chip?.textContent).toContain(FREE_MODEL)
    await click(chip)
    expect(byTestId('ai-model-sheet')).not.toBeNull()
    expect(options().length).toBeGreaterThan(0)
    expect(options().every((m) => m.endsWith(':free'))).toBe(true)
    expect(
      byTestId('ai-model-sheet')!
        .querySelector(`[data-model="${FREE_MODEL}"]`)
        ?.getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('saves the chosen model as the AI in use and the next turn runs on it', async () => {
    const rust = makeFakeAiRust({ snapshot: freeOpenRouter() })
    await mountAi(rust)
    await click(byTestId('ai-model-chip'))
    const other = options().find((m) => m !== FREE_MODEL)!
    await click(document.querySelector(`[data-testid="ai-model-option"][data-model="${other}"]`))
    await settle()
    const saved = rust.commands.find((c) => c.command === 'mobile_set_ai_settings')
    expect(saved?.args).toEqual({
      selectedProvider: 'openrouter',
      modelPatch: { provider: 'openrouter', model: other },
    })
    expect(byTestId('ai-model-sheet')).toBeNull()
    expect(byTestId('ai-model-chip')?.textContent).toContain(other)

    await typeAndSend('hello')
    await waitFor(() => rust.relayStarts.length === 1)
    expect(relayJson(rust.relayStarts[0]!).model).toBe(other)
  })

  it('cannot be opened while a run is going', async () => {
    const rust = makeFakeAiRust({ snapshot: keyProvider('openai', 'gpt-5.6'), relay: () => 'hang' })
    await mountAi(rust)
    await typeAndSend('hello')
    await waitFor(() => rust.relayStarts.length === 1)
    const chip = byTestId<HTMLButtonElement>('ai-model-chip')!
    expect(chip.disabled).toBe(true)
    await click(chip)
    expect(byTestId('ai-model-sheet')).toBeNull()
  })

  it('shows the connect card instead of the chip when no AI is connected', async () => {
    const rust = makeFakeAiRust({
      snapshot: {
        selectedProvider: 'auto',
        modelByProvider: {},
        configuredProviders: {},
        chatgptVisible: false,
        subscriptionNoticeVersion: 0,
      },
    })
    await mountAi(rust)
    expect(byTestId('ai-connect-prompt')).not.toBeNull()
    expect(byTestId('ai-model-chip')).toBeNull()
  })
})
