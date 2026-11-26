/**
 * The answer shapes of the shared mobile AI tools (docs/plans/mobile-v1/T7.md
 * section 1). One mobile shape per tool; each editor track converts it to what
 * its PC skill expects. A tool never throws: a failure or a tool that is off is
 * a `MobileAiToolError`.
 */
import type {
  ImageSearchResult,
  WebSearchResult,
} from '../../../../../../packages/ai-search/src/shared'

export type { ImageSearchResult, WebSearchResult }

export type MobileAiToolErrorCode =
  /** the tool is off (AI off, switch off, no picture model, model cannot see) or not bound */
  | 'unavailable'
  /** the request itself is unusable (empty prompt, no pictures, wrong argument type) */
  | 'invalid_input'
  /** generateImage: the model name is not one of the image route's models */
  | 'invalid_model'
  // read_url and picture fetching (PC ReadUrlErrorCode)
  | 'invalid_url'
  | 'blocked'
  | 'network'
  | 'timeout'
  | 'http_error'
  | 'unsupported_type'
  | 'too_large'
  | 'empty'
  /** an AI result address that is not in the store */
  | 'not_found'
  /** the AI run was stopped while the tool ran; its requests were cut and nothing was kept */
  | 'cancelled'
  /** anything else (a provider refusal, a broken answer) */
  | 'failed'

export interface MobileAiToolError {
  /** English sentence for the model; never shown as is */
  readonly error: string
  readonly errorCode: MobileAiToolErrorCode
  /** the HTTP status behind an `http_error` */
  readonly status?: number
}

export interface MobileAiToolAvailability {
  /** AI on + "Let AI use internet tools" on: web_search, image_search, read_url, fetching pictures */
  readonly web: boolean
  /** "AI makes pictures" on + a picture model on a key provider whose key is saved (OpenAI, Gemini) */
  readonly imageGeneration: boolean
  /** the selected chat model can look at pictures (PC modelLacksVision) */
  readonly pictureAnalysis: boolean
}

/** PC `webSearch` fields; `method` names the backend that answered. */
export type WebSearchAnswer =
  | {
      readonly results: readonly WebSearchResult[]
      readonly method: 'parallel' | 'duckduckgo'
    }
  | MobileAiToolError

/** PC `imageSearch` fields, filtered like PC `filterUsableImages`. */
export type ImageSearchAnswer =
  | { readonly images: readonly ImageSearchResult[]; readonly method: 'duckduckgo' }
  | MobileAiToolError

/** One slice of a page: the fields PC `readUrlModelText` reads (PC `ReadUrlSuccess` without `ok`). */
export interface ReadUrlPage {
  /** the final address after redirects (a GitHub blob already rewritten to raw) */
  readonly url: string
  readonly title?: string
  readonly text: string
  /** where this slice starts */
  readonly offset: number
  readonly totalChars: number
  readonly truncated: boolean
  /** where the next slice starts; only when truncated */
  readonly nextOffset?: number
}

export type ReadUrlAnswer = ReadUrlPage | MobileAiToolError

export interface MobileAiPicture {
  readonly bytes: Uint8Array
  readonly mime: string
}

export type FetchImageAnswer = MobileAiPicture | MobileAiToolError

export interface GenerateImageRequest {
  readonly prompt: string
  /** aspect ratio in PC's vocabulary (1:1, 4:3, 16:9, 9:16, 3:4, 2:3, 3:2, auto) */
  readonly size?: string
  /** a model of the image route (its catalog or the saved one); absent = the saved model */
  readonly model?: string
  /** ask for real alpha where the model has a control for it (PC GenerateImageInput.transparent) */
  readonly transparent?: boolean
}

export type GenerateImageAnswer =
  | {
      /** AI result store address (`ai-result://…`); read the bytes with fetchImage */
      readonly url: string
      readonly mime: string
      /** the model that made it, in its listed spelling */
      readonly model: string
      readonly provider: 'openai' | 'gemini'
    }
  | MobileAiToolError

export interface AnalyzeMediaRequest {
  readonly prompt: string
  /** pictures only in 1.0 (image/*); video and audio answer `unavailable` */
  readonly images: readonly MobileAiPicture[]
}

export type AnalyzeMediaAnswer = { readonly text: string } | MobileAiToolError

/** A photo the person attached in the AI sheet for this conversation (memory only). */
export interface MobileAiAttachment {
  readonly id: string
  readonly name: string
  readonly mime: string
  readonly bytes: Uint8Array
}

export interface MobileAiTools {
  /** Read again for every run (settings changes apply from the next turn). */
  availability(): MobileAiToolAvailability
  webSearch(query: string, maxResults?: number): Promise<WebSearchAnswer>
  imageSearch(query: string, maxResults?: number): Promise<ImageSearchAnswer>
  readUrl(url: string, offset?: number): Promise<ReadUrlAnswer>
  /** A picture from a public http(s) address or an AI result store address. */
  fetchImage(url: string): Promise<FetchImageAnswer>
  generateImage(request: GenerateImageRequest): Promise<GenerateImageAnswer>
  analyzeMedia(request: AnalyzeMediaRequest): Promise<AnalyzeMediaAnswer>
  /** The photos the person attached in the AI sheet during this conversation. */
  attachments(): readonly MobileAiAttachment[]
}

export function isMobileAiToolError(value: unknown): value is MobileAiToolError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { error?: unknown }).error === 'string' &&
    typeof (value as { errorCode?: unknown }).errorCode === 'string'
  )
}

export function toolError(
  errorCode: MobileAiToolErrorCode,
  error: string,
  extra: { status?: number } = {},
): MobileAiToolError {
  return { error, errorCode, ...(extra.status !== undefined ? { status: extra.status } : {}) }
}
