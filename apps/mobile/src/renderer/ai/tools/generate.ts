/**
 * Picture making on mobile: PC's generation code
 * (packages/ai-provider/src/media-protocols.ts) for the two image providers of
 * 1.0, OpenAI and Gemini, its requests going through Rust's sealed relay with
 * the `__sealed__:<provider>` placeholder in the key position (the mobile
 * `aiFetch`). Only their JSON generation path runs (no reference pictures, so
 * no multipart form). The bytes go to the AI result store and the tool answers
 * with the store address. Loaded only when a picture is made.
 */
import { AI_MEDIA_PROVIDERS } from '@genoffice/ai-provider/browser'
import {
  bindMobileAiRelay,
  putMobileAiResultImage,
  sealedKeyOf,
  type MobileAiCommandClient,
  type MobileAiImageProvider,
} from '@genoffice/mobile-bridge/ai-bridge'
import type { MobileTransport } from '@genoffice/mobile-bridge/transport'
import { generateImageWithProvider } from '../../../../../../packages/ai-provider/src/media-protocols'
import { bytesToBase64, sniffPictureMime } from './pictures'
import { toolError, type GenerateImageAnswer } from './types'

/** The formats the result store keeps */
const STORABLE = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** Refused locally: the provider answered with an address to download instead of bytes. */
const FOREIGN_HOST = { code: 'INVALID_ARGUMENT', messageKey: 'mobile.ai.relayHostNotAllowed' }

/**
 * The relay client for one generation: a request to any host but the
 * provider's own (PC downloads an image answer given as an address) is refused
 * here, before Rust, and remembered.
 */
function providerOnlyClient(
  client: MobileAiCommandClient,
  providerHost: string,
  onForeign: () => void,
): MobileAiCommandClient {
  const transport: MobileTransport = {
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      if (command === 'mobile_ai_relay_start') {
        let host: string
        try {
          host = new URL(String(args?.url)).host.toLowerCase()
        } catch {
          host = ''
        }
        if (host !== providerHost) {
          onForeign()
          return Promise.reject(FOREIGN_HOST)
        }
      }
      return client.transport.invoke<T>(command, args)
    },
    listen: (event, handler) => client.transport.listen(event, handler),
  }
  return { transport }
}

export async function mobileGenerateImage(
  client: MobileAiCommandClient,
  provider: MobileAiImageProvider,
  model: string,
  request: { prompt: string; size?: string | undefined; transparent?: boolean | undefined },
): Promise<GenerateImageAnswer> {
  const meta = AI_MEDIA_PROVIDERS.find((m) => m.id === provider)
  if (!meta?.defaultBaseUrl) {
    return toolError('unavailable', 'Picture making is not available for this provider.')
  }
  const providerHost = new URL(meta.defaultBaseUrl).host.toLowerCase()
  let askedForeign = false
  bindMobileAiRelay(
    providerOnlyClient(client, providerHost, () => {
      askedForeign = true
    }),
  )
  let blob: { bytes: Uint8Array; mime: string }
  try {
    blob = await generateImageWithProvider(
      provider,
      { apiKey: sealedKeyOf(provider), imageModel: model, analysisModel: '' },
      {
        prompt: request.prompt,
        ...(request.size ? { aspectRatio: request.size } : {}),
        ...(request.transparent ? { transparent: true } : {}),
      },
    )
  } catch (err) {
    if (askedForeign) {
      return toolError(
        'unavailable',
        'The image provider answered with an address to download, which picture making on the phone does not take; no image was made.',
      )
    }
    const detail = err instanceof Error ? err.message : String(err)
    return toolError('failed', `Image generation failed: ${detail.slice(0, 500)}`)
  } finally {
    // the chat transport binds the plain client before each turn; leave it bound too
    bindMobileAiRelay(client)
  }
  const mime = sniffPictureMime(blob.bytes) ?? blob.mime
  if (!STORABLE.has(mime)) {
    return toolError('failed', `The image provider answered with an unusable format (${mime}).`)
  }
  try {
    const stored = await putMobileAiResultImage(client, {
      dataBase64: bytesToBase64(blob.bytes),
      mime,
    })
    return { url: stored.address, mime: stored.mime, model, provider }
  } catch {
    return toolError('failed', 'The picture was made but could not be stored.')
  }
}
