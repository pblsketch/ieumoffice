/**
 * Showing pictures to the chat model: one turn without tools on the provider
 * the chat runs on, through the same mobile transport (key providers over the
 * sealed relay), the answer collected from the stream. Same as PC
 * analyzeImagesWithChatProvider (packages/ai-search/src/chat-analysis.ts):
 * the prompt, the 20 MB budget and the five-minute deadline are PC's.
 */
import { createMobileAgentTransport } from '@genoffice/mobile-bridge/ai-bridge'
import type { MobileClient } from '@genoffice/mobile-bridge/transport'
import { bytesToBase64 } from './pictures'
import { toolError, type AnalyzeMediaAnswer, type MobileAiPicture } from './types'

/** PC CHAT_ANALYSIS_MAX_BYTES */
const CHAT_ANALYSIS_MAX_BYTES = 20 * 1024 * 1024
/** PC CHAT_ANALYSIS_TIMEOUT_MS */
const CHAT_ANALYSIS_TIMEOUT_MS = 300_000

const SYSTEM_PROMPT =
  'You are shown one or more images from an office document or from the user. Answer the request about them directly and completely, in plain text. You have no tools: do not try to call any.'

export async function mobileAnalyzePictures(
  client: MobileClient,
  prompt: string,
  pictures: readonly MobileAiPicture[],
): Promise<AnalyzeMediaAnswer> {
  const total = pictures.reduce((n, p) => n + p.bytes.byteLength, 0)
  if (total > CHAT_ANALYSIS_MAX_BYTES) {
    // refused whole: nothing is dropped or downscaled behind the person's back
    return toolError(
      'too_large',
      `The images are too large to show to the AI provider (${total} bytes, limit ${CHAT_ANALYSIS_MAX_BYTES}); analyze fewer or smaller images`,
    )
  }
  const images = pictures.map((p) => ({ base64: bytesToBase64(p.bytes), mime: p.mime }))
  const transport = createMobileAgentTransport(client)
  return new Promise<AnalyzeMediaAnswer>((resolve) => {
    let text = ''
    let settled = false
    let handle: { cancel(): void } | null = null
    const timer = setTimeout(() => {
      handle?.cancel()
      settle(toolError('timeout', 'Image analysis timed out.'))
    }, CHAT_ANALYSIS_TIMEOUT_MS)
    const settle = (answer: AnalyzeMediaAnswer) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(answer)
    }
    handle = transport.stream(
      {
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', text: prompt, images }],
        tools: [],
      },
      {
        onDelta: (delta) => {
          text += delta
        },
        // no tools were offered; a call the model invents anyway has nothing to run
        onToolCall: () => {},
        onDone: () =>
          settle(
            text.trim() ? { text } : toolError('failed', 'The AI provider returned no analysis.'),
          ),
        onError: (error) => settle(toolError('failed', `Image analysis failed: ${error}`)),
      },
    )
  })
}
