/**
 * What the AI sheet's model chip and model sheet show: the model a turn would
 * run on now, and for every connected provider the models PC's
 * `keyProviderModels` lists (an OpenRouter free connection lists only `:free`
 * models, the tested ones first). Pure functions over the key-free settings
 * snapshot; nothing here sends anything.
 */
import {
  AI_PROVIDERS,
  OPENROUTER_FREE_MODELS,
  isOpenRouterFreeModel,
  keyProviderModels,
  modelLacksVision,
  type AiProviderId,
} from '@genoffice/ai-provider/browser'
import { projectMobileAiSettings, selectMobileAiProvider } from '@genoffice/mobile-bridge/ai-bridge'
import type {
  MobileAiSettingsSnapshot,
  MobileChatGptStatus,
} from '@genoffice/mobile-bridge/transport'

export interface MobileModelGroup {
  readonly provider: AiProviderId
  /** the provider's own name (the self-hosted server is named by the screen) */
  readonly label: string
  /** an OpenRouter free connection */
  readonly free: boolean
  readonly models: readonly string[]
}

export interface MobileCurrentModel {
  readonly provider: string
  readonly model: string
}

/** A provider counts as connected with a saved key, or (self-hosted server) a saved address. */
function connected(snapshot: MobileAiSettingsSnapshot, id: AiProviderId): boolean {
  const configured = snapshot.configuredProviders[id]
  if (!configured) return false
  return configured.hasKey || id === 'custom'
}

/** The model lists of the connected providers, in PC's provider order. */
export function mobileModelGroups(
  snapshot: MobileAiSettingsSnapshot | null | undefined,
): MobileModelGroup[] {
  if (!snapshot) return []
  const groups: MobileModelGroup[] = []
  for (const meta of AI_PROVIDERS) {
    if (!connected(snapshot, meta.id)) continue
    const configured = snapshot.configuredProviders[meta.id]!
    const stored = snapshot.modelByProvider[meta.id]?.trim() ?? ''
    const free = meta.id === 'openrouter' && configured.freeOnly === true
    let models: string[]
    if (free) {
      // keyProviderModels reads "free" from the stored model; seed it with a free
      // one when the stored model is missing, and drop anything not `:free`
      const listed = configured.models
      const seed = isOpenRouterFreeModel(stored)
        ? stored
        : (OPENROUTER_FREE_MODELS.find((id) => listed.includes(id)) ??
          OPENROUTER_FREE_MODELS[0] ??
          '')
      models = keyProviderModels(meta.id, seed, listed).filter((m) => isOpenRouterFreeModel(m))
    } else {
      models = keyProviderModels(meta.id, stored, configured.models)
    }
    if (models.length === 0) continue
    groups.push({ provider: meta.id, label: meta.label, free, models })
  }
  return groups
}

/** The provider and model the next turn runs on, or null when no AI is connected. */
export function mobileCurrentModel(
  snapshot: MobileAiSettingsSnapshot | null | undefined,
  chatgpt: MobileChatGptStatus | null | undefined,
): MobileCurrentModel | null {
  if (!snapshot) return null
  try {
    const choice = selectMobileAiProvider(snapshot, chatgpt ?? { state: 'hidden' })
    if (!choice.connected) return null
    const projected = projectMobileAiSettings(snapshot)
    const model =
      snapshot.modelByProvider[choice.provider]?.trim() ||
      projected.providers[choice.provider]?.model?.trim() ||
      ''
    return { provider: choice.provider, model }
  } catch {
    return null
  }
}

/** Whether the model the next turn runs on can look at pictures (PC's modelLacksVision). */
export function mobileModelSeesPictures(current: MobileCurrentModel | null): boolean {
  if (!current) return false
  return !(current.model && modelLacksVision(current.model))
}

/** The OpenRouter free connection takes `:free` models only (Rust refuses the rest too). */
export function mobileModelAllowed(
  snapshot: MobileAiSettingsSnapshot | null | undefined,
  provider: string,
  model: string,
): boolean {
  if (!model.trim()) return false
  const configured = snapshot?.configuredProviders[provider]
  if (provider === 'openrouter' && configured?.freeOnly === true) {
    return isOpenRouterFreeModel(model)
  }
  return true
}
