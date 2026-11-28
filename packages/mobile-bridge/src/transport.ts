import type { AgentMessage, AgentToolCall, AgentToolDef } from '@genoffice/agent-core'

export const MOBILE_ERROR_CODES = [
  'PERMISSION_DENIED',
  'READ_ONLY_URI',
  'FILE_TOO_LARGE',
  'CORRUPT_CONTAINER',
  'PASSWORD_PROTECTED',
  'BACKUP_FAILED',
  'USER_CANCELLED',
  'AUTH_NOT_CONFIGURED',
  'AUTH_DENIED',
  'AUTH_NO_PLAN',
  'AUTH_TIMEOUT',
  'NETWORK_ERROR',
  'RATE_LIMITED',
  'SIGNED_OUT',
  'INVALID_ARGUMENT',
  'INTERNAL_ERROR',
] as const

export type MobileErrorCode = (typeof MOBILE_ERROR_CODES)[number]

export interface MobileErrorPayload {
  readonly code: MobileErrorCode
  readonly messageKey: string
  readonly detail?: string
}

export class MobileCommandError extends Error {
  readonly code: MobileErrorCode
  readonly messageKey: string
  readonly detail?: string

  constructor(payload: MobileErrorPayload) {
    super(payload.detail ? `${payload.code}: ${payload.detail}` : payload.code)
    this.name = 'MobileCommandError'
    this.code = payload.code
    this.messageKey = payload.messageKey
    this.detail = payload.detail
  }
}

export function isMobileCommandError(value: unknown): value is MobileCommandError {
  return value instanceof MobileCommandError
}

export function parseMobileCommandError(raw: unknown): MobileCommandError {
  if (raw instanceof MobileCommandError) return raw
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>
    if (
      typeof record.code === 'string' &&
      (MOBILE_ERROR_CODES as readonly string[]).includes(record.code) &&
      typeof record.messageKey === 'string'
    ) {
      return new MobileCommandError({
        code: record.code as MobileErrorCode,
        messageKey: record.messageKey,
        detail: typeof record.detail === 'string' ? record.detail : undefined,
      })
    }
  }
  return new MobileCommandError({
    code: 'INTERNAL_ERROR',
    messageKey: 'mobile.internalError',
    detail: raw instanceof Error ? raw.message : String(raw),
  })
}

export type MobileDocFormat = 'hwp' | 'hwpx' | 'md' | 'txt'
export type MobileShareMode = 'edited' | 'original'
export type MobileRestoreTarget = 'in-place' | 'save-as'
export type MobileTheme = 'light' | 'dark' | 'system'

export interface MobileDocSession {
  readonly sessionId: string
  readonly docKey: string
  readonly name: string
  readonly ext: string
  readonly format: MobileDocFormat
  readonly writable: boolean
  readonly ephemeral: boolean
  readonly uriHint?: string
}

export interface ReadFileBytesResult {
  readonly bytesBase64: string
  readonly trackingDropped?: boolean
  readonly encrypted?: boolean
  readonly distribution?: boolean
}

export interface TabSpot {
  readonly section: number
  readonly para: number
  readonly tabIdx: number
  readonly before: string
  readonly after: string
  readonly charShapeId: number
  readonly tabDefId: number
}

export interface MeasuredTab {
  readonly section: number
  readonly para: number
  readonly tabIdx: number
  readonly widthHwpUnit: number
}

export interface HwpPreviewPayload {
  readonly text: string
  readonly imageBase64?: string | null
}

export interface HwpMemoSnapshot {
  readonly id: string
  readonly author: string
  readonly text: string
}

export interface HwpFixPayload {
  readonly format: 'hwp' | 'hwpx'
  readonly measuredTabs?: readonly MeasuredTab[]
  readonly preview?: HwpPreviewPayload
  readonly memos?: readonly HwpMemoSnapshot[] | null
}

export interface SaveFileBytesResult {
  readonly ok: boolean
  readonly backupId?: string
  readonly tailsLost?: boolean
  readonly memosLost?: number
}

export interface RecentDocEntry {
  readonly id: string
  readonly docKey: string
  readonly name: string
  readonly format: MobileDocFormat
  readonly openedAt: number
}

export interface RecoveryEntry {
  readonly docKey: string
  readonly format: MobileDocFormat
  readonly title: string
  readonly updatedAt: number
  readonly sizeBytes: number
}

export interface HwpBackupEntry {
  readonly backupId: string
  readonly docKey: string
  readonly originalName: string
  readonly format: 'hwp' | 'hwpx'
  readonly createdAt: number
  readonly sizeBytes: number
}

export interface RestoreBackupResult {
  readonly ok: boolean
  readonly session?: MobileDocSession
}

export interface MobileAppPrefs {
  readonly lang: string
  readonly theme: MobileTheme
  readonly hwpDefaultFormat: 'hwp' | 'hwpx'
  readonly aiEnabled: boolean
}

export interface MobileAppPrefsPatch {
  readonly lang?: string
  readonly theme?: MobileTheme
  readonly hwpDefaultFormat?: 'hwp' | 'hwpx'
  readonly aiEnabled?: boolean
}

export interface ConfiguredProviderSummary {
  readonly hasKey: boolean
  readonly freeOnly?: boolean
  readonly models: readonly string[]
}

export interface MobileAiSettingsSnapshot {
  readonly selectedProvider: string
  readonly modelByProvider: Readonly<Record<string, string>>
  readonly configuredProviders: Readonly<Record<string, ConfiguredProviderSummary>>
  readonly chatgptVisible: boolean
  readonly subscriptionNoticeVersion: number
}

export interface MobileAiSettingsPatch {
  readonly selectedProvider?: string
  readonly modelPatch?: { readonly provider: string; readonly model: string }
  readonly providerKeyPatch?: {
    readonly provider: string
    readonly apiKey: string | null
    readonly freeOnly?: boolean
  }
  readonly subscriptionNoticeVersion?: number
}

export interface ValidateKeyResult {
  readonly ok: boolean
  readonly models: readonly string[]
}

export interface MobileChatGptLoginFailure {
  readonly reason: 'timeout' | 'denied' | 'no-plan' | 'network'
  readonly step?: string
  readonly httpStatus?: number
  readonly oauthError?: string
}

export interface MobileChatGptStatus {
  readonly state: 'hidden' | 'signed-out' | 'ready' | 'checking' | 'error'
  readonly account?: string
  readonly sharing?: boolean
  readonly loginFailure?: MobileChatGptLoginFailure
}

export interface MobileAiStreamRequest {
  readonly requestId: string
  readonly system: string
  readonly messages: readonly AgentMessage[]
  readonly tools: readonly AgentToolDef[]
  readonly maxTokens?: number
}

export interface MobileAiStreamChunk {
  readonly requestId: string
  readonly type:
    | 'delta'
    | 'reasoning'
    | 'tool-call'
    | 'usage'
    | 'subscription-usage'
    | 'input-truncated'
    | 'done'
    | 'error'
    | 'ping'
  readonly text?: string
  readonly toolCall?: AgentToolCall
  readonly error?: string
  readonly errorCode?: string
  readonly errorProvider?: string
  readonly stopReason?: string
  readonly usage?: {
    readonly inputTokens?: number
    readonly outputTokens?: number
  }
}

export type MobileUnlisten = () => void

export interface MobileTransport {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
  listen<T>(event: string, handler: (payload: T) => void): Promise<MobileUnlisten>
}

export interface MobileClient {
  readonly transport: MobileTransport
  createUntitledSession(format: 'hwp' | 'hwpx' | 'md'): Promise<MobileDocSession>
  pickOpenFile(exts: readonly string[]): Promise<MobileDocSession>
  openRecentDoc(id: string): Promise<MobileDocSession>
  consumePendingOpenIntent(): Promise<MobileDocSession | null>
  readFileBytes(sessionId: string): Promise<ReadFileBytesResult>
  hwpNewTabs(sessionId: string, bytesBase64: string, format: 'hwp' | 'hwpx'): Promise<TabSpot[]>
  saveFileBytes(
    sessionId: string,
    bytesBase64: string,
    hwpFix?: HwpFixPayload,
  ): Promise<SaveFileBytesResult>
  saveAsFileBytes(params: {
    sessionId?: string
    suggestedName: string
    format: MobileDocFormat
    bytesBase64: string
    hwpFix?: HwpFixPayload
  }): Promise<MobileDocSession>
  shareFile(params: {
    sessionId: string
    suggestedName: string
    mode: MobileShareMode
    bytesBase64?: string
  }): Promise<{ ok: boolean }>
  listRecentDocs(): Promise<RecentDocEntry[]>
  removeRecentDoc(id: string): Promise<{ ok: boolean }>
  recoveryWrite(params: {
    docKey: string
    format: MobileDocFormat
    title: string
    bytesBase64: string
  }): Promise<{ ok: boolean }>
  recoveryList(): Promise<RecoveryEntry[]>
  recoveryRead(docKey: string): Promise<string>
  recoveryDiscard(docKey: string): Promise<{ ok: boolean }>
  hwpBackupList(): Promise<HwpBackupEntry[]>
  hwpBackupRestore(backupId: string, target: MobileRestoreTarget): Promise<RestoreBackupResult>
  hwpBackupDelete(backupId: string): Promise<{ ok: boolean }>
  getAppPrefs(): Promise<MobileAppPrefs>
  setAppPrefs(patch: MobileAppPrefsPatch): Promise<MobileAppPrefs>
  getAiSettings(): Promise<MobileAiSettingsSnapshot>
  setAiSettings(patch: MobileAiSettingsPatch): Promise<MobileAiSettingsSnapshot>
  validateAiKey(params: {
    provider: string
    apiKey: string
    freeOnly?: boolean
  }): Promise<ValidateKeyResult>
  startAiStream(request: MobileAiStreamRequest): Promise<{ ok: boolean }>
  cancelAiStream(requestId: string): Promise<{ ok: boolean }>
  onAiStreamChunk(handler: (chunk: MobileAiStreamChunk) => void): Promise<MobileUnlisten>
  chatgptStatus(): Promise<MobileChatGptStatus>
  chatgptSignIn(reconsent?: boolean): Promise<string>
  chatgptCompleteCallback(url: string): Promise<MobileChatGptStatus>
  chatgptSignOut(): Promise<{ ok: boolean }>
}

async function invokeChecked<T>(
  transport: MobileTransport,
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await transport.invoke<T>(command, args)
  } catch (err) {
    throw parseMobileCommandError(err)
  }
}

export function createMobileClient(transport: MobileTransport): MobileClient {
  return {
    transport,
    createUntitledSession: (format) =>
      invokeChecked(transport, 'mobile_create_untitled_session', { format }),
    pickOpenFile: (exts) => invokeChecked(transport, 'mobile_pick_open_file', { exts: [...exts] }),
    openRecentDoc: (id) => invokeChecked(transport, 'mobile_open_recent_doc', { id }),
    consumePendingOpenIntent: () => invokeChecked(transport, 'mobile_consume_pending_open_intent'),
    readFileBytes: (sessionId) => invokeChecked(transport, 'mobile_read_file_bytes', { sessionId }),
    hwpNewTabs: (sessionId, bytesBase64, format) =>
      invokeChecked(transport, 'mobile_hwp_new_tabs', { sessionId, bytesBase64, format }),
    saveFileBytes: (sessionId, bytesBase64, hwpFix) =>
      invokeChecked(transport, 'mobile_save_file_bytes', {
        sessionId,
        bytesBase64,
        ...(hwpFix ? { hwpFix } : {}),
      }),
    saveAsFileBytes: (params) =>
      invokeChecked(transport, 'mobile_save_as_file_bytes', {
        sessionId: params.sessionId ?? null,
        suggestedName: params.suggestedName,
        format: params.format,
        bytesBase64: params.bytesBase64,
        ...(params.hwpFix ? { hwpFix: params.hwpFix } : {}),
      }),
    shareFile: (params) =>
      invokeChecked(transport, 'mobile_share_file', {
        sessionId: params.sessionId,
        suggestedName: params.suggestedName,
        mode: params.mode,
        bytesBase64: params.bytesBase64 ?? null,
      }),
    listRecentDocs: () => invokeChecked(transport, 'mobile_list_recent_docs'),
    removeRecentDoc: (id) => invokeChecked(transport, 'mobile_remove_recent_doc', { id }),
    recoveryWrite: (params) => invokeChecked(transport, 'mobile_recovery_write', { ...params }),
    recoveryList: () => invokeChecked(transport, 'mobile_recovery_list'),
    recoveryRead: (docKey) => invokeChecked(transport, 'mobile_recovery_read', { docKey }),
    recoveryDiscard: (docKey) => invokeChecked(transport, 'mobile_recovery_discard', { docKey }),
    hwpBackupList: () => invokeChecked(transport, 'mobile_hwp_backup_list'),
    hwpBackupRestore: (backupId, target) =>
      invokeChecked(transport, 'mobile_hwp_backup_restore', { backupId, target }),
    hwpBackupDelete: (backupId) =>
      invokeChecked(transport, 'mobile_hwp_backup_delete', { backupId }),
    getAppPrefs: () => invokeChecked(transport, 'mobile_get_app_prefs'),
    setAppPrefs: (patch) => invokeChecked(transport, 'mobile_set_app_prefs', { ...patch }),
    getAiSettings: () => invokeChecked(transport, 'mobile_get_ai_settings'),
    setAiSettings: (patch) => invokeChecked(transport, 'mobile_set_ai_settings', { ...patch }),
    validateAiKey: (params) =>
      invokeChecked(transport, 'mobile_ai_validate_key', {
        provider: params.provider,
        apiKey: params.apiKey,
        freeOnly: params.freeOnly ?? null,
      }),
    startAiStream: (request) => invokeChecked(transport, 'mobile_ai_stream_start', { ...request }),
    cancelAiStream: (requestId) =>
      invokeChecked(transport, 'mobile_ai_stream_cancel', { requestId }),
    onAiStreamChunk: (handler) =>
      transport.listen<MobileAiStreamChunk>('mobile:ai-stream-chunk', handler),
    chatgptStatus: () => invokeChecked(transport, 'mobile_chatgpt_status'),
    chatgptSignIn: (reconsent) =>
      invokeChecked(transport, 'mobile_chatgpt_sign_in', { reconsent: reconsent ?? false }),
    chatgptCompleteCallback: (url) =>
      invokeChecked(transport, 'mobile_chatgpt_complete_callback', { url }),
    chatgptSignOut: () => invokeChecked(transport, 'mobile_chatgpt_sign_out'),
  }
}

interface TauriGlobalInternals {
  invoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T>
}

interface TauriEventGlobal {
  listen?: <T>(event: string, handler: (ev: { payload: T }) => void) => Promise<() => void>
}

/**
 * Creates a Tauri v2 WebView transport using injected `__TAURI__` / `__TAURI_INTERNALS__`
 * globals so `@genoffice/mobile-bridge` stays testable in plain Node/jsdom without bundling Tauri.
 */
export function createTauriMobileTransport(): MobileTransport {
  return {
    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      const g = globalThis as unknown as {
        __TAURI__?: { core?: TauriGlobalInternals }
        __TAURI_INTERNALS__?: TauriGlobalInternals
      }
      const invokeFn = g.__TAURI__?.core?.invoke ?? g.__TAURI_INTERNALS__?.invoke
      if (!invokeFn) {
        throw new MobileCommandError({
          code: 'INTERNAL_ERROR',
          messageKey: 'mobile.transportUnavailable',
          detail: 'Tauri runtime bridge is not available in this environment.',
        })
      }
      return invokeFn<T>(command, args)
    },
    async listen<T>(event: string, handler: (payload: T) => void): Promise<MobileUnlisten> {
      const g = globalThis as unknown as {
        __TAURI__?: { event?: TauriEventGlobal }
      }
      const listenFn = g.__TAURI__?.event?.listen
      if (!listenFn) {
        return () => {}
      }
      return listenFn<T>(event, (ev) => handler(ev.payload))
    },
  }
}
