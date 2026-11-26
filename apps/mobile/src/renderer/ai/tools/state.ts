/**
 * What the shared AI tools read at call time: the client and the AI state
 * useMobileAi binds, the AI tool settings from Rust (cached, refreshed per
 * run), and the photos attached in the AI sheet. Importing this module sends
 * nothing.
 */
import {
  AI_MEDIA_PROVIDERS,
  modelLacksVision,
  type AiProviderChoice,
} from '@genoffice/ai-provider/browser'
import {
  getMobileAiToolSettings,
  projectMobileAiSettings,
  selectMobileAiProvider,
  setMobileAiToolSettings,
  type MobileAiImageProvider,
  type MobileAiToolSettings,
  type MobileAiToolSettingsPatch,
} from '@genoffice/mobile-bridge/ai-bridge'
import type {
  MobileAiSettingsSnapshot,
  MobileChatGptStatus,
  MobileClient,
} from '@genoffice/mobile-bridge/transport'
import type { MobileAiAttachment, MobileAiToolAvailability } from './types'

/** What useMobileAi hands the tools; the getters read its latest state. */
export interface MobileAiToolsBinding {
  readonly client: MobileClient
  /** prefs.aiEnabled */
  getAiEnabled(): boolean
  /** the AI settings snapshot the AI sheet shows (selected provider and models) */
  getAiSettings(): MobileAiSettingsSnapshot | null
  getChatgptStatus(): MobileChatGptStatus | null
}

let binding: MobileAiToolsBinding | null = null
let toolSettings: MobileAiToolSettings | null = null
const settingsListeners = new Set<(settings: MobileAiToolSettings | null) => void>()

/** Binds the tools to the app's client and AI state; returns the unbind for this binding. */
export function bindMobileAiTools(next: MobileAiToolsBinding | null): () => void {
  binding = next
  if (!next) toolSettings = null
  return () => {
    if (binding !== next) return
    binding = null
    toolSettings = null
  }
}

export function boundMobileAiTools(): MobileAiToolsBinding | null {
  return binding
}

/** The image providers of 1.0: they answer with base64 and use the same company's chat key. */
export const MOBILE_IMAGE_PROVIDERS: readonly MobileAiImageProvider[] = ['openai', 'gemini']

function isImageProvider(value: unknown): value is MobileAiImageProvider {
  return (MOBILE_IMAGE_PROVIDERS as readonly unknown[]).includes(value)
}

/** Rust's answer as the tools trust it: anything not plainly on is off. */
function normalized(raw: unknown): MobileAiToolSettings | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const ready = Array.isArray(r.imageProvidersReady)
    ? r.imageProvidersReady.filter(isImageProvider)
    : []
  return {
    internetTools: r.internetTools === true,
    imageGeneration: r.imageGeneration === true,
    imageProvider: isImageProvider(r.imageProvider) ? r.imageProvider : null,
    imageModel: typeof r.imageModel === 'string' && r.imageModel.trim() ? r.imageModel : null,
    imageProvidersReady: ready,
  }
}

function setToolSettings(next: MobileAiToolSettings | null): void {
  toolSettings = next
  for (const listener of [...settingsListeners]) listener(next)
}

/** Re-reads the AI tool settings from Rust (once per run); null (all off) when unreadable. */
export async function refreshMobileAiToolSettings(): Promise<MobileAiToolSettings | null> {
  const current = binding
  if (!current) return null
  let next: MobileAiToolSettings | null
  try {
    next = normalized(await getMobileAiToolSettings(current.client))
  } catch {
    next = null
  }
  if (binding === current) setToolSettings(next)
  return next
}

/** Saves a patch of the AI tool settings and caches Rust's answer (the settings screen). */
export async function updateMobileAiToolSettings(
  patch: MobileAiToolSettingsPatch,
): Promise<MobileAiToolSettings | null> {
  const current = binding
  if (!current) return null
  const next = normalized(await setMobileAiToolSettings(current.client, patch))
  if (binding === current) setToolSettings(next)
  return next
}

/** The cached AI tool settings (null until read, or when unreadable). */
export function mobileAiToolSettings(): MobileAiToolSettings | null {
  return toolSettings
}

export function onMobileAiToolSettingsChanged(
  listener: (settings: MobileAiToolSettings | null) => void,
): () => void {
  settingsListeners.add(listener)
  return () => settingsListeners.delete(listener)
}

/** Whether the web tools may run now: AI on and the internet switch on (as read last). */
export function mobileWebToolsOn(): boolean {
  try {
    return binding?.getAiEnabled() === true && toolSettings?.internetTools === true
  } catch {
    return false
  }
}

/** The picture route when picture making is on and usable: provider, saved model. */
export function mobileImageRoute(): { provider: MobileAiImageProvider; model: string } | null {
  try {
    const settings = toolSettings
    if (!binding?.getAiEnabled() || !settings?.imageGeneration) return null
    const provider = settings.imageProvider
    if (!provider || !isImageProvider(provider)) return null
    if (!settings.imageProvidersReady.includes(provider)) return null
    if (!settings.imageModel) return null
    if (!AI_MEDIA_PROVIDERS.some((meta) => meta.id === provider)) return null
    return { provider, model: settings.imageModel }
  } catch {
    return null
  }
}

/** The chat provider and model a turn would run on now, or null when none is connected. */
export function mobileChatModel(): { choice: AiProviderChoice; model: string } | null {
  const current = binding
  if (!current) return null
  const snapshot = current.getAiSettings()
  if (!snapshot) return null
  const choice = selectMobileAiProvider(snapshot, current.getChatgptStatus() ?? { state: 'hidden' })
  if (!choice.connected) return null
  const projected = projectMobileAiSettings(snapshot)
  const model =
    projected.providers[choice.provider]?.model ?? snapshot.modelByProvider[choice.provider] ?? ''
  return { choice, model: model.trim() }
}

export function mobileAiToolAvailability(): MobileAiToolAvailability {
  try {
    if (!binding || !binding.getAiEnabled()) {
      return { web: false, imageGeneration: false, pictureAnalysis: false }
    }
    const chat = mobileChatModel()
    return {
      web: mobileWebToolsOn(),
      imageGeneration: mobileImageRoute() !== null,
      pictureAnalysis: chat !== null && !(chat.model && modelLacksVision(chat.model)),
    }
  } catch {
    return { web: false, imageGeneration: false, pictureAnalysis: false }
  }
}

// ---------------------------------------------------------------------------
// Tool calls in flight: a Stop cuts their Rust requests (PC abortMediaCalls)
// ---------------------------------------------------------------------------

const inFlightToolCalls = new Set<AbortController>()

/**
 * One tool call starts: its signal feeds the Rust requests it sends (the
 * relay, search and public address requests send Rust's cancel on abort).
 * `end` must run when the call settles.
 */
export function beginMobileAiToolCall(): { readonly signal: AbortSignal; end(): void } {
  const controller = new AbortController()
  inFlightToolCalls.add(controller)
  return { signal: controller.signal, end: () => inFlightToolCalls.delete(controller) }
}

/**
 * The AI run stopped (Stop, stop everything, a document change, AI turned
 * off): every tool call in flight is aborted and answers `cancelled`. A run
 * executes its tools after its model turn ended, so cancelling the turn alone
 * would leave a picture being made or a page being read.
 */
export function abortMobileAiToolCalls(): void {
  for (const controller of [...inFlightToolCalls]) {
    inFlightToolCalls.delete(controller)
    controller.abort()
  }
}

// ---------------------------------------------------------------------------
// What the tools remember between calls (pages read), forgotten on a new conversation
// ---------------------------------------------------------------------------

const resetListeners = new Set<() => void>()

/** A tool module that remembers something registers how to forget it. */
export function onMobileAiToolsReset(listener: () => void): () => void {
  resetListeners.add(listener)
  return () => resetListeners.delete(listener)
}

/** Forgets what the tools remember between calls (a document change, a new conversation). */
export function resetMobileAiTools(): void {
  for (const listener of [...resetListeners]) listener()
}

// ---------------------------------------------------------------------------
// Photos attached in the AI sheet (this conversation, memory only)
// ---------------------------------------------------------------------------

let attachments: MobileAiAttachment[] = []
let attachmentSeq = 0
const attachmentListeners = new Set<() => void>()
/** the base64 an attachment was added with: the one copy it keeps (shared with the sent message) */
const attachmentBase64 = new WeakMap<MobileAiAttachment, string>()

function attachmentsChanged(): void {
  for (const listener of [...attachmentListeners]) listener()
}

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  }
  return btoa(binary)
}

/**
 * Adds a photo of this conversation. Given as base64 (the AI sheet's photos),
 * the store keeps that same string, the one the sent message's picture holds,
 * and decodes `bytes` only when a tool reads them; given as bytes, it keeps
 * those.
 */
export function addMobileAiAttachment(
  photo:
    | { readonly name: string; readonly mime: string; readonly bytes: Uint8Array }
    | { readonly name: string; readonly mime: string; readonly base64: string },
): MobileAiAttachment {
  attachmentSeq += 1
  const id = `photo-${attachmentSeq}`
  let added: MobileAiAttachment
  if ('base64' in photo) {
    const b64 = photo.base64
    added = {
      id,
      name: photo.name,
      mime: photo.mime,
      get bytes() {
        return decodeBase64(b64)
      },
    }
    attachmentBase64.set(added, b64)
  } else {
    added = { id, name: photo.name, mime: photo.mime, bytes: photo.bytes }
  }
  attachments = [...attachments, added]
  attachmentsChanged()
  return added
}

/** An attachment's picture as base64: the kept string when it was added so, else encoded. */
export function mobileAiAttachmentBase64(attachment: MobileAiAttachment): string {
  return attachmentBase64.get(attachment) ?? encodeBase64(attachment.bytes)
}

export function removeMobileAiAttachment(id: string): void {
  const next = attachments.filter((a) => a.id !== id)
  if (next.length === attachments.length) return
  attachments = next
  attachmentsChanged()
}

/** The attached photos, oldest first (a new array only when it changed). */
export function listMobileAiAttachments(): readonly MobileAiAttachment[] {
  return attachments
}

export function clearMobileAiAttachments(): void {
  if (attachments.length === 0) return
  attachments = []
  attachmentsChanged()
}

export function onMobileAiAttachmentsChanged(listener: () => void): () => void {
  attachmentListeners.add(listener)
  return () => attachmentListeners.delete(listener)
}
