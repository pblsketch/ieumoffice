import type { AgentMessage } from '@genoffice/agent-core'
import { getUiLang } from '@genoffice/i18n'
import { isLocalOllamaUrl } from './ollama-servers'
import type { AiProviderConfig } from './types'
import { AiTimeoutError } from './watchdog'

const HANGUL_RE = /[\uAC00-\uD7A3]/

function preferKorean(messages?: readonly AgentMessage[], system?: string): boolean {
  const ui = getUiLang()
  if (ui === 'ko') return true
  if (
    messages?.some((m) => m.role !== 'tool' && typeof m.text === 'string' && HANGUL_RE.test(m.text))
  )
    return true
  if (system && HANGUL_RE.test(system)) return true
  return false
}

function modelLabelOf(config: AiProviderConfig, ko: boolean): string {
  const trimmed = config.model?.trim()
  if (trimmed) return trimmed
  return ko ? '현재 모델' : 'the selected model'
}

/**
 * Whether an OpenAI-compatible request is targeting an Ollama or custom endpoint
 * whose known system/protocol errors should be answered as a friendly assistant
 * explanation instead of a raw error banner.
 */
export function isOllamaOrCustomRequest(baseUrl: string, isCustomProvider?: boolean): boolean {
  return isCustomProvider === true || isLocalOllamaUrl(baseUrl)
}

export function explainOllamaVisionUnsupported(
  config: AiProviderConfig,
  messages?: readonly AgentMessage[],
  system?: string,
): string {
  const ko = preferKorean(messages, system)
  const model = modelLabelOf(config, ko)
  if (ko) {
    return (
      `현재 선택된 모델(**${model}**)은 이미지를 인식하지 못하는 텍스트 전용 모델입니다.\n\n` +
      `- **이미지 없이 진행하려면**: 첨부된 이미지를 제거하거나 이미지가 필요하지 않은 작업으로 다시 요청해 주세요.\n` +
      `- **이미지 인식(AI 꾸미기·이미지 분석 등)을 사용하려면**: **설정 → Ollama** 탭에서 **비전** 배지가 표시된 모델(예: \`gemma3\`, \`qwen2.5-vl\`, \`llava\` 등)을 등록·선택한 뒤 다시 시도해 주세요.`
    )
  }
  return (
    `The selected model (**${model}**) is a text-only model and cannot recognize images.\n\n` +
    `- **To continue with this model**: remove the attached image and try again with text only.\n` +
    `- **To use image recognition or visual styling**: open **Settings → Ollama** and select a model marked with the **Vision** badge (such as \`gemma3\`, \`qwen2.5-vl\`, or \`llava\`).`
  )
}

/**
 * Maps known Ollama / local-model system errors (unsupported vision/multimodal
 * input, request timeouts, server crashes/CUDA/OOM errors, connection refused,
 * missing model, or context overflow) to a friendly assistant reply. Returns
 * `null` for unrecognized errors.
 */
export function explainOllamaSystemError(
  err: unknown,
  config: AiProviderConfig,
  messages?: readonly AgentMessage[],
  system?: string,
): string | null {
  const ko = preferKorean(messages, system)
  const model = modelLabelOf(config, ko)
  const raw = err instanceof Error ? err.message : String(err ?? '')

  // 1. Vision / multimodal unsupported
  if (
    /(?:does not support|doesn't support|unsupported).{0,50}(?:image|vision|multimodal)|(?:image|vision|multimodal).{0,50}(?:not supported|unsupported|does not support)|missing mmproj/i.test(
      raw,
    )
  ) {
    return explainOllamaVisionUnsupported(config, messages, system)
  }

  // 2. Request / connection timeout
  if (
    err instanceof AiTimeoutError ||
    /AI request timed out|timed out after \d+s|HeadersTimeoutError|BodyTimeoutError|ETIMEDOUT/i.test(
      raw,
    )
  ) {
    const secMatch = /(\d+)\s*s\b/.exec(raw)
    const configuredMin = config.connectTimeoutMs
      ? Math.max(1, Math.round(config.connectTimeoutMs / 60_000))
      : undefined
    if (ko) {
      const timeNote = configuredMin
        ? ` (현재 설정: 약 ${configuredMin}분)`
        : secMatch
          ? ` (${secMatch[1]}초 경과)`
          : ''
      return (
        `로컬 AI 모델(**${model}**)의 응답 대기 시간이 초과되었습니다${timeNote}.\n\n` +
        `모델 크기가 크거나 처음 메모리에 불러오는 중일 때는 첫 응답까지 시간이 더 걸릴 수 있습니다. **설정 → Ollama** 탭에서 해당 서버의 **첫 응답 대기 시간(분)**을 늘린 뒤 다시 시도해 주세요.`
      )
    }
    const timeNote = configuredMin
      ? ` (current timeout: ${configuredMin} min)`
      : secMatch
        ? ` (${secMatch[1]}s elapsed)`
        : ''
    return (
      `The local AI model (**${model}**) timed out before completing its response${timeNote}.\n\n` +
      `Loading a large local model into memory can take longer on the first request. Please increase the **First-response timeout (min)** setting in **Settings → Ollama** and try again.`
    )
  }

  // 3. Local model process crash / CUDA / VRAM / memory error
  if (
    /llama-server process has terminated|CUDA error|ROCm error|Vulkan error|out of memory|failed to allocate|GGML_ASSERT|exit status 0x|model failed to load|unable to load model|not enough memory|requires more system memory/i.test(
      raw,
    )
  ) {
    if (ko) {
      return (
        `로컬 AI 모델(**${model}**)을 실행하는 중 시스템 리소스 오류(GPU/메모리 부족 또는 서버 프로세스 종료)가 발생했습니다.\n\n` +
        `- 그래픽카드(VRAM) 또는 시스템 메모리가 부족할 때 주로 발생합니다.\n` +
        `- **설정 → Ollama** 탭에서 더 낮은 단계(**Low** 또는 **Medium**)의 모델을 선택하거나, 더 가벼운 모델을 사용해 주세요.\n` +
        `- 오류가 계속되면 Ollama 서버(또는 PC)를 재시작한 뒤 다시 시도해 주세요.`
      )
    }
    return (
      `The local AI server encountered a system resource error (GPU/memory exhaustion or process termination) while running **${model}**.\n\n` +
      `- Try selecting a lower effort level (**Low** or **Medium**) or a smaller model in **Settings → Ollama**.\n` +
      `- If the problem persists, restart the Ollama server and try again.`
    )
  }

  // 4. Model not found on Ollama server
  if (/HTTP 404\b[\s\S]*model[\s\S]*not found|model\s+['"][^'"]+['"]\s+not found/i.test(raw)) {
    if (ko) {
      return (
        `선택된 모델(**${model}**)을 Ollama 서버에서 찾을 수 없습니다.\n\n` +
        `서버에서 해당 모델이 삭제되었거나 이름이 변경되었을 수 있습니다. **설정 → Ollama** 탭에서 모델 목록을 새로고침하고 사용할 모델을 다시 등록·선택해 주세요.`
      )
    }
    return (
      `The selected model (**${model}**) was not found on the Ollama server.\n\n` +
      `Please refresh the model list in **Settings → Ollama** and select an installed model.`
    )
  }

  // 5. Context length / token limit exceeded
  if (
    /context length|maximum context|prompt is too long|too many tokens|exceeds the available context/i.test(
      raw,
    )
  ) {
    if (ko) {
      return (
        `요청하신 내용이 현재 모델(**${model}**)의 한 번에 처리 가능한 입력 길이를 초과했습니다.\n\n` +
        `요청할 내용을 나누어 보내시거나, **설정 → Ollama** 탭에서 더 높은 단계(**Medium** 또는 **High**, 더 큰 컨텍스트 크기)로 등록된 모델을 선택해 다시 시도해 주세요.`
      )
    }
    return (
      `The request exceeded the context length of the selected model (**${model}**).\n\n` +
      `Please try a shorter prompt or select a higher effort preset (**Medium** or **High**) in **Settings → Ollama**.`
    )
  }

  // 6. Ollama server unreachable / connection refused
  if (
    /ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|fetch failed|Failed to fetch|network error/i.test(
      raw,
    )
  ) {
    if (ko) {
      return (
        `Ollama 서버에 연결할 수 없습니다.\n\n` +
        `PC 또는 지정한 주소에서 Ollama가 실행 중인지 확인하시고, **설정 → Ollama** 탭에서 서버 주소와 연결 상태를 확인한 뒤 다시 시도해 주세요.`
      )
    }
    return (
      `Could not connect to the Ollama server.\n\n` +
      `Please make sure Ollama is running and check the server URL and connection status in **Settings → Ollama**.`
    )
  }

  return null
}
