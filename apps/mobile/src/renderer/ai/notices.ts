/**
 * The notices of the AI sheet and how a failed turn maps onto them (spec 3.1
 * table). The ChatGPT notices stay as they were; the key-provider codes come
 * from the transport's `MobileAiStreamErrorCode`. A code this table does not
 * know is shown as the connection error, and nothing ever moves to another
 * provider.
 */
import type { MobileStreamErrorDetail } from '@genoffice/mobile-bridge/ai-bridge'

export type AiNoticeKind =
  // ChatGPT (hidden on mobile 1.0, kept as it was)
  | 'usage-limit'
  | 'sharing-declined'
  | 'reauth'
  // any provider: network and anything not classified
  | 'connection-error'
  // key providers (spec 3.1)
  | 'free-limit'
  | 'free-tier-model'
  | 'credits'
  | 'overloaded'
  | 'auth'
  // the editor did not send the document because of hidden content (blocked.ts)
  | 'blocked-hidden'

export interface AiNotice {
  readonly kind: AiNoticeKind
  /** free-limit: when the free allowance resets (epoch ms), when known */
  readonly resetsAt?: number
}

export function noticeForStreamError(detail: MobileStreamErrorDetail): AiNotice {
  switch (detail.errorCode) {
    case 'rate-limit':
      return { kind: 'usage-limit' }
    case 'signed-out':
      return { kind: 'reauth' }
    case 'free-limit':
      return typeof detail.errorResetsAt === 'number' && Number.isFinite(detail.errorResetsAt)
        ? { kind: 'free-limit', resetsAt: detail.errorResetsAt }
        : { kind: 'free-limit' }
    case 'free-tier-model':
      return { kind: 'free-tier-model' }
    case 'credits':
      return { kind: 'credits' }
    case 'overloaded':
      return { kind: 'overloaded' }
    case 'auth':
      return { kind: 'auth' }
    default:
      return { kind: 'connection-error' }
  }
}
