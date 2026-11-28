/**
 * Classifies transport-level connectivity failures (DNS, refused/reset
 * connections, dead proxies/VPNs, TLS certificates) so the apps can show
 * localized recovery guidance instead of raw error strings.
 */

export type AiNetworkErrorKind = 'proxy-error' | 'cert-error' | 'network-unreachable' | 'network'

const PROXY_ERROR_PATTERN = new RegExp(
  [
    'ERR_PROXY_CONNECTION_FAILED',
    'ERR_TUNNEL_CONNECTION_FAILED',
    'ERR_PROXY_AUTH_REQUESTED',
    'ERR_SOCKS_CONNECTION_FAILED',
    'PROXY_AUTH_REQUIRED',
    '\\b407\\b.*proxy',
    'proxy.*\\b407\\b',
    'proxy authentication required',
    'tunneling socket could not be established',
    'EPROXY',
  ].join('|'),
  'i',
)

const CERT_ERROR_PATTERN = new RegExp(
  [
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'CERT_HAS_EXPIRED',
    'CERT_NOT_YET_VALID',
    'CERT_UNTRUSTED',
    'CERT_REVOKED',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'ERR_CERT_[A-Z_]+',
    'ERR_SSL_[A-Z_]+',
    'unable to verify the first certificate',
    'self-signed certificate',
  ].join('|'),
  'i',
)

const UNREACHABLE_ERROR_PATTERN = new RegExp(
  [
    'ENOTFOUND',
    'EAI_AGAIN',
    'ENETUNREACH',
    'ENETDOWN',
    'EHOSTUNREACH',
    'EHOSTDOWN',
    'ERR_INTERNET_DISCONNECTED',
    'ERR_NAME_NOT_RESOLVED',
    'ERR_ADDRESS_UNREACHABLE',
    'ERR_NETWORK_CHANGED',
    'ERR_NETWORK',
  ].join('|'),
  'i',
)

// Node/undici error codes plus Chromium net-stack error names (net.fetch rescue path)
const NETWORK_ERROR_PATTERN = new RegExp(
  [
    'fetch failed',
    'socket hang up',
    'network error',
    'ECONNRESET',
    'ECONNREFUSED',
    'ECONNABORTED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ENETUNREACH',
    'ENETDOWN',
    'EHOSTUNREACH',
    'EHOSTDOWN',
    'EPIPE',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
    'UND_ERR_CLOSED',
    'UND_ERR_DESTROYED',
    'ERR_NETWORK',
    'ERR_INTERNET_DISCONNECTED',
    'ERR_NAME_NOT_RESOLVED',
    'ERR_CONNECTION_[A-Z_]+',
    'ERR_PROXY_CONNECTION_FAILED',
    'ERR_TUNNEL_CONNECTION_FAILED',
    'ERR_TIMED_OUT',
    'ERR_ADDRESS_UNREACHABLE',
  ].join('|'),
  'i',
)

function collectErrorSignals(err: unknown): string[] {
  const signals: string[] = []
  let current: unknown = err
  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current === 'string') {
      signals.push(current)
      break
    }
    const e = current as { message?: unknown; code?: unknown; status?: unknown; cause?: unknown }
    if (typeof e.code === 'string') signals.push(e.code)
    if (typeof e.status === 'number' && e.status === 407) signals.push('407 proxy')
    if (typeof e.message === 'string') signals.push(e.message)
    current = e.cause
  }
  return signals
}

/**
 * Classifies a transport-level failure into a specific recovery error kind
 * (`proxy-error`, `cert-error`, `network-unreachable`, or generic `network`).
 * Returns undefined when the error does not look like a transport failure.
 */
export function classifyAiNetworkError(err: unknown): AiNetworkErrorKind | undefined {
  const signals = collectErrorSignals(err)
  if (signals.length === 0) return undefined
  if (signals.some((s) => PROXY_ERROR_PATTERN.test(s))) return 'proxy-error'
  if (signals.some((s) => CERT_ERROR_PATTERN.test(s))) return 'cert-error'
  if (signals.some((s) => UNREACHABLE_ERROR_PATTERN.test(s))) return 'network-unreachable'
  if (signals.some((s) => NETWORK_ERROR_PATTERN.test(s))) return 'network'
  return undefined
}

/**
 * True when the error (or anything in its `cause` chain) looks like a network
 * connectivity failure. Provider wrappers embed the cause code in the message
 * (e.g. "Claude fetch failed: ... cause=ECONNRESET"), so the message text is
 * checked as well as structured `code` fields.
 */
export function isAiNetworkError(err: unknown): boolean {
  return classifyAiNetworkError(err) !== undefined
}
