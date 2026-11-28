/**
 * Pictures for the AI tools: fetching one from a public address (Rust's
 * public address request) or from the AI result store (`ai-result://`), and
 * the base64 and format helpers the tools share.
 */
import {
  mobileWebFetch,
  readMobileAiResultImage,
  type MobileAiCommandClient,
} from '@genoffice/mobile-bridge/ai-bridge'
import { isMobileCommandError } from '@genoffice/mobile-bridge/transport'
import { toolError, type FetchImageAnswer } from './types'
import { webFetchFailure } from './webText'

export const AI_RESULT_SCHEME = 'ai-result://'

/** The formats the editors' insert paths take, as PC remoteImageHeaders advertises them */
const PICTURE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp;q=0.9'

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** The raster format the bytes declare (PC media-protocols sniffImageMime), or null. */
export function sniffPictureMime(bytes: Uint8Array): string | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) {
    return 'image/png'
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes.length > 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif'
  }
  if (
    bytes.length > 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

export async function mobileFetchStoredImage(
  client: MobileAiCommandClient,
  address: string,
): Promise<FetchImageAnswer> {
  try {
    const stored = await readMobileAiResultImage(client, address)
    return { bytes: base64ToBytes(stored.dataBase64), mime: stored.mime }
  } catch (err) {
    const key = isMobileCommandError(err) ? err.messageKey : ''
    if (key === 'mobile.ai.resultNotFound') {
      return toolError('not_found', 'That AI result picture is no longer stored.')
    }
    if (key === 'mobile.ai.resultAddressInvalid') {
      return toolError('invalid_url', 'Not a usable AI result address.')
    }
    return toolError('failed', 'The AI result picture could not be read.')
  }
}

/**
 * A picture from a public http(s) address: the bytes must be a picture (by
 * their own signature, or a declared raster image type when the format has
 * none the sniffer knows). SVG and everything else is refused.
 */
export async function mobileFetchWebImage(
  client: MobileAiCommandClient,
  url: string,
  signal?: AbortSignal,
): Promise<FetchImageAnswer> {
  let target: URL
  try {
    target = new URL(url.trim())
  } catch {
    return toolError('invalid_url', 'Not a usable picture address.')
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return toolError('invalid_url', 'Only http and https picture addresses can be fetched.')
  }
  let response: Response
  try {
    response = await mobileWebFetch(client, target.toString(), {
      headers: { Accept: PICTURE_ACCEPT },
      signal,
    })
  } catch (err) {
    return webFetchFailure(err)
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    return toolError('http_error', `The server answered with HTTP ${response.status}.`, {
      status: response.status,
    })
  }
  const declared = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  const generic = declared === '' || declared === 'application/octet-stream'
  if (!generic && (!declared.startsWith('image/') || declared === 'image/svg+xml')) {
    await response.body?.cancel().catch(() => {})
    return toolError('unsupported_type', `This address is not a picture (${declared}).`)
  }
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await response.arrayBuffer())
  } catch (err) {
    return webFetchFailure(err)
  }
  const sniffed = sniffPictureMime(bytes)
  if (sniffed) return { bytes, mime: sniffed }
  if (!generic && bytes.length > 0) return { bytes, mime: declared }
  return toolError('unsupported_type', 'This address is not a picture.')
}
