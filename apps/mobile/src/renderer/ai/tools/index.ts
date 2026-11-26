/**
 * The shared AI tools of mobile 1.0 (docs/plans/mobile-v1/T7.md section 1):
 * web search, picture search, reading an address, fetching and making
 * pictures, showing pictures to the chat model, and the photos attached in
 * the AI sheet. Every request goes through Rust (search hosts, the public
 * address check, the sealed relay); the webview holds no key and never uses
 * its own network. A tool never throws: failures and tools that are off answer
 * `{ error, errorCode }` (`unavailable` when off or not bound yet).
 *
 * useMobileAi binds the tools (`bindMobileAiTools`, from ./state so this
 * module stays out of the app's first load) and refreshes the tool settings
 * before each run. Importing this module sends nothing; the page converter
 * (PC htmlToText) and PC's picture making code load on first use.
 */
import { mobileAnalyzePictures } from './analyze'
import { mobileImageModelChoice } from './imageModel'
import { AI_RESULT_SCHEME, mobileFetchStoredImage, mobileFetchWebImage } from './pictures'
import { mobileImageSearch, mobileWebSearch } from './search'
import {
  boundMobileAiTools,
  listMobileAiAttachments,
  mobileAiToolAvailability,
  mobileImageRoute,
  mobileWebToolsOn,
} from './state'
import {
  toolError,
  type AnalyzeMediaAnswer,
  type AnalyzeMediaRequest,
  type FetchImageAnswer,
  type GenerateImageAnswer,
  type GenerateImageRequest,
  type ImageSearchAnswer,
  type MobileAiTools,
  type ReadUrlAnswer,
  type WebSearchAnswer,
} from './types'

export type {
  AnalyzeMediaAnswer,
  AnalyzeMediaRequest,
  FetchImageAnswer,
  GenerateImageAnswer,
  GenerateImageRequest,
  ImageSearchAnswer,
  ImageSearchResult,
  MobileAiAttachment,
  MobileAiPicture,
  MobileAiToolAvailability,
  MobileAiToolError,
  MobileAiToolErrorCode,
  MobileAiTools,
  ReadUrlAnswer,
  ReadUrlPage,
  WebSearchAnswer,
  WebSearchResult,
} from './types'
export { isMobileAiToolError } from './types'
export {
  addMobileAiAttachment,
  bindMobileAiTools,
  clearMobileAiAttachments,
  listMobileAiAttachments,
  mobileAiToolSettings,
  onMobileAiAttachmentsChanged,
  onMobileAiToolSettingsChanged,
  refreshMobileAiToolSettings,
  removeMobileAiAttachment,
  resetMobileAiTools,
  updateMobileAiToolSettings,
  type MobileAiToolsBinding,
} from './state'
export { mobileReadUrlModelText } from './webText'

const NOT_BOUND = 'The AI tools are not ready on this phone.'
const WEB_OFF =
  'Internet tools are off: AI is off or "Let AI use internet tools" is off in Settings.'

function failed(err: unknown): ReturnType<typeof toolError> {
  const detail = err instanceof Error ? err.message : String(err)
  return toolError('failed', `The tool failed: ${detail.slice(0, 300)}`)
}

/** Runs a tool body; anything it throws becomes a `failed` answer. */
async function safely<T>(body: () => Promise<T>): Promise<T | ReturnType<typeof toolError>> {
  try {
    return await body()
  } catch (err) {
    return failed(err)
  }
}

let readUrlModule: Promise<typeof import('./readUrl')> | null = null
let generateModule: Promise<typeof import('./generate')> | null = null

function loadReadUrl() {
  readUrlModule ??= import('./readUrl').catch((err: unknown) => {
    readUrlModule = null
    throw err
  })
  return readUrlModule
}

function loadGenerate() {
  generateModule ??= import('./generate').catch((err: unknown) => {
    generateModule = null
    throw err
  })
  return generateModule
}

const tools: MobileAiTools = {
  availability: () => mobileAiToolAvailability(),

  webSearch: (query, maxResults) =>
    safely<WebSearchAnswer>(async () => {
      const bound = boundMobileAiTools()
      if (!bound) return toolError('unavailable', NOT_BOUND)
      if (!mobileWebToolsOn()) return toolError('unavailable', WEB_OFF)
      return mobileWebSearch(bound.client, query, maxResults)
    }),

  imageSearch: (query, maxResults) =>
    safely<ImageSearchAnswer>(async () => {
      const bound = boundMobileAiTools()
      if (!bound) return toolError('unavailable', NOT_BOUND)
      if (!mobileWebToolsOn()) return toolError('unavailable', WEB_OFF)
      return mobileImageSearch(bound.client, query, maxResults)
    }),

  readUrl: (url, offset) =>
    safely<ReadUrlAnswer>(async () => {
      const bound = boundMobileAiTools()
      if (!bound) return toolError('unavailable', NOT_BOUND)
      if (!mobileWebToolsOn()) return toolError('unavailable', WEB_OFF)
      const { mobileReadUrl } = await loadReadUrl()
      return mobileReadUrl(bound.client, url, offset)
    }),

  fetchImage: (url) =>
    safely<FetchImageAnswer>(async () => {
      const bound = boundMobileAiTools()
      if (!bound) return toolError('unavailable', NOT_BOUND)
      if (typeof url !== 'string' || !url.trim()) {
        return toolError('invalid_url', 'The picture address is empty.')
      }
      const address = url.trim()
      // the store is on the phone: reading it reaches nothing outside
      if (address.toLowerCase().startsWith(AI_RESULT_SCHEME)) {
        return mobileFetchStoredImage(bound.client, address)
      }
      if (!mobileWebToolsOn()) return toolError('unavailable', WEB_OFF)
      return mobileFetchWebImage(bound.client, address)
    }),

  generateImage: (request: GenerateImageRequest) =>
    safely<GenerateImageAnswer>(async () => {
      const bound = boundMobileAiTools()
      if (!bound) return toolError('unavailable', NOT_BOUND)
      const route = mobileImageRoute()
      if (!route) {
        return toolError(
          'unavailable',
          'Picture making is off: turn on "AI makes pictures" and choose a picture model in Settings.',
        )
      }
      const prompt = typeof request?.prompt === 'string' ? request.prompt.trim() : ''
      if (!prompt) return toolError('invalid_input', 'The picture request is empty.')
      const choice = mobileImageModelChoice(request.model, route.provider, route.model)
      if (choice.kind === 'refuse') return toolError('invalid_model', choice.message)
      const { mobileGenerateImage } = await loadGenerate()
      return mobileGenerateImage(bound.client, route.provider, choice.model, {
        prompt,
        size: typeof request.size === 'string' ? request.size : undefined,
        transparent: request.transparent === true,
      })
    }),

  analyzeMedia: (request: AnalyzeMediaRequest) =>
    safely<AnalyzeMediaAnswer>(async () => {
      const bound = boundMobileAiTools()
      if (!bound) return toolError('unavailable', NOT_BOUND)
      if (!mobileAiToolAvailability().pictureAnalysis) {
        return toolError(
          'unavailable',
          'The selected AI model cannot look at pictures; choose a model that can.',
        )
      }
      const images = Array.isArray(request?.images) ? request.images : []
      const prompt = typeof request?.prompt === 'string' ? request.prompt : ''
      if (images.length === 0 || !prompt.trim()) {
        return toolError('invalid_input', 'Give a request and at least one picture.')
      }
      if (images.some((p) => !(p?.bytes instanceof Uint8Array) || typeof p.mime !== 'string')) {
        return toolError('invalid_input', 'A picture has no bytes or type.')
      }
      if (images.some((p) => !p.mime.toLowerCase().startsWith('image/'))) {
        return toolError('unavailable', 'Video and audio analysis is not available on the phone.')
      }
      return mobileAnalyzePictures(bound.client, prompt, images)
    }),

  attachments: () => {
    try {
      return listMobileAiAttachments()
    } catch {
      return []
    }
  },
}

/** The shared AI tools (one object for the app; every call reads the current state). */
export function getMobileAiTools(): MobileAiTools {
  return tools
}
