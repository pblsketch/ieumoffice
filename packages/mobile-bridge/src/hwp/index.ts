import type { Lang } from '@genoffice/i18n'
import {
  isMobileCommandError,
  MobileCommandError,
  type MeasuredTab,
  type MobileClient,
  type MobileDocSession,
  type MobileTheme,
  type TabSpot,
} from '../transport'

export const MOBILE_STUDIO_SETTINGS_KEY = 'rhwp-settings'

export interface UnsupportedHwpResult {
  readonly ok: false
  readonly error: 'unsupported-on-mobile'
}

const UNSUPPORTED_ON_MOBILE: UnsupportedHwpResult = {
  ok: false,
  error: 'unsupported-on-mobile',
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'))
  }
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}

/**
 * Forces Canvas2D rendering (disabling canvaskit-wasm for iOS WKWebView memory safety)
 * and disables studio IndexedDB draft autosave before rhwp-studio initializes.
 */
export function seedMobileHwpStudioSettings(stored: string | null, theme: MobileTheme): string {
  let prev: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(stored ?? '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      prev = parsed as Record<string, unknown>
    }
  } catch {
    prev = {}
  }
  const prevTheme =
    prev.theme && typeof prev.theme === 'object' ? (prev.theme as Record<string, unknown>) : {}
  const prevAutosave =
    prev.autosave && typeof prev.autosave === 'object'
      ? (prev.autosave as Record<string, unknown>)
      : {}
  const prevRendering =
    prev.rendering && typeof prev.rendering === 'object'
      ? (prev.rendering as Record<string, unknown>)
      : {}

  return JSON.stringify({
    ...prev,
    renderer: 'canvas2d',
    rendering: {
      ...prevRendering,
      backend: 'canvas2d',
      useCanvasKit: false,
    },
    theme: {
      ...prevTheme,
      mode: theme,
    },
    autosave: {
      ...prevAutosave,
      recoveryEnabled: false,
      idleSaveEnabled: false,
    },
  })
}

export function mobileHwpStudioUrl(lang: Lang): string {
  const studioLang = lang === 'ko' ? 'ko' : 'en'
  return `./studio/index.html?chrome=embed&renderer=canvas2d&lang=${studioLang}`
}

export interface HwpSaveVerifyInfo {
  readonly pageCountBefore: number
  readonly pageCountAfter: number
  readonly recovered: boolean
}

export interface MobileHwpEditorPort {
  isPasswordProtected(): Promise<boolean>
  exportHwp(): Promise<Uint8Array>
  exportHwpx(): Promise<Uint8Array>
  exportHwpVerify(): Promise<HwpSaveVerifyInfo>
  measureTabs(spots: readonly TabSpot[]): Promise<readonly MeasuredTab[]>
  getPlainText(): Promise<string>
  replaceText(find: string, replace: string): Promise<boolean>
  notifySaved(fileName?: string): Promise<void>
}

export interface HwpProtectionFlags {
  readonly encrypted: boolean
  readonly distribution: boolean
}

export interface MobileHwpOpenResult {
  readonly bytes: Uint8Array
  readonly trackingDropped: boolean
  readonly encrypted: boolean
  readonly distribution: boolean
}

export type MobileHwpSaveOutcome =
  | {
      readonly kind: 'saved'
      readonly backupId?: string
      readonly tailsLost?: boolean
      readonly memosLost?: number
      readonly session?: MobileDocSession
    }
  | {
      readonly kind: 'failed'
      readonly reason: 'protected' | 'verify' | 'backup-failed' | 'read-only' | 'write'
      readonly detail?: string
    }

export interface MobileHwpApi {
  readDocument(session: MobileDocSession): Promise<MobileHwpOpenResult>
  saveDocument(
    session: MobileDocSession,
    editor: MobileHwpEditorPort,
    flags: HwpProtectionFlags,
  ): Promise<MobileHwpSaveOutcome>
  saveAsDocument(
    session: MobileDocSession | null,
    suggestedName: string,
    format: 'hwp' | 'hwpx',
    editor: MobileHwpEditorPort,
    flags: HwpProtectionFlags,
  ): Promise<MobileHwpSaveOutcome>
  shareDocument(
    session: MobileDocSession,
    editor: MobileHwpEditorPort,
    flags: HwpProtectionFlags,
  ): Promise<{ readonly ok: boolean }>
  writeRecovery(
    session: MobileDocSession,
    editor: MobileHwpEditorPort,
    flags: HwpProtectionFlags,
  ): Promise<{ readonly ok: boolean }>
  // Explicitly excluded Cycle 1 HWP features (Spec §2.4 & §4.3)
  printPages(): Promise<UnsupportedHwpResult>
  exportPdf(): Promise<UnsupportedHwpResult>
  openHanjaDict(): Promise<UnsupportedHwpResult>
  copyFormat(): Promise<UnsupportedHwpResult>
  openMemoPanel(): Promise<UnsupportedHwpResult>
  runDocCheck(): Promise<UnsupportedHwpResult>
}

async function prepareExportedHwp(
  session: MobileDocSession | null,
  format: 'hwp' | 'hwpx',
  editor: MobileHwpEditorPort,
  client: MobileClient,
): Promise<
  | {
      readonly ok: true
      readonly bytesBase64: string
      readonly measuredTabs: readonly MeasuredTab[]
    }
  | { readonly ok: false; readonly reason: 'verify' | 'write'; readonly detail?: string }
> {
  if (format === 'hwp') {
    const verify = await editor.exportHwpVerify()
    if (!verify.recovered || verify.pageCountBefore !== verify.pageCountAfter) {
      return { ok: false, reason: 'verify' }
    }
  }
  const bytes = format === 'hwpx' ? await editor.exportHwpx() : await editor.exportHwp()
  const bytesBase64 = bytesToBase64(bytes)

  let measuredTabs: readonly MeasuredTab[] = []
  if (session) {
    try {
      const spots = await client.hwpNewTabs(session.sessionId, bytesBase64, format)
      if (spots.length > 0) {
        measuredTabs = await editor.measureTabs(spots)
      }
    } catch {
      measuredTabs = []
    }
  }

  return { ok: true, bytesBase64, measuredTabs }
}

export function createMobileHwpApi(client: MobileClient): MobileHwpApi {
  return {
    async readDocument(session) {
      const res = await client.readFileBytes(session.sessionId)
      return {
        bytes: base64ToBytes(res.bytesBase64),
        trackingDropped: res.trackingDropped === true,
        encrypted: res.encrypted === true,
        distribution: res.distribution === true,
      }
    },

    async saveDocument(session, editor, flags) {
      const editorProtected = await editor.isPasswordProtected().catch(() => true)
      if (flags.encrypted || flags.distribution || editorProtected) {
        return { kind: 'failed', reason: 'protected' }
      }
      if (!session.writable || session.ephemeral) {
        return { kind: 'failed', reason: 'read-only' }
      }

      const format: 'hwp' | 'hwpx' = session.format === 'hwpx' ? 'hwpx' : 'hwp'
      const exported = await prepareExportedHwp(session, format, editor, client)
      if (!exported.ok) {
        return { kind: 'failed', reason: exported.reason, detail: exported.detail }
      }

      try {
        const res = await client.saveFileBytes(session.sessionId, exported.bytesBase64, {
          format,
          measuredTabs: exported.measuredTabs,
        })
        await editor.notifySaved(session.name).catch(() => {})
        await client.recoveryDiscard(session.docKey).catch(() => {})
        return {
          kind: 'saved',
          backupId: res.backupId,
          tailsLost: res.tailsLost,
          memosLost: res.memosLost,
        }
      } catch (err) {
        if (isMobileCommandError(err)) {
          if (err.code === 'PASSWORD_PROTECTED') return { kind: 'failed', reason: 'protected' }
          if (err.code === 'BACKUP_FAILED') return { kind: 'failed', reason: 'backup-failed' }
          if (err.code === 'READ_ONLY_URI') return { kind: 'failed', reason: 'read-only' }
        }
        return {
          kind: 'failed',
          reason: 'write',
          detail: err instanceof Error ? err.message : String(err),
        }
      }
    },

    async saveAsDocument(session, suggestedName, format, editor, flags) {
      const editorProtected = await editor.isPasswordProtected().catch(() => true)
      if (flags.encrypted || flags.distribution || editorProtected) {
        return { kind: 'failed', reason: 'protected' }
      }

      const exported = await prepareExportedHwp(session, format, editor, client)
      if (!exported.ok) {
        return { kind: 'failed', reason: exported.reason, detail: exported.detail }
      }

      try {
        const nextSession = await client.saveAsFileBytes({
          sessionId: session?.sessionId,
          suggestedName,
          format,
          bytesBase64: exported.bytesBase64,
          hwpFix: {
            format,
            measuredTabs: exported.measuredTabs,
          },
        })
        await editor.notifySaved(nextSession.name).catch(() => {})
        if (session) {
          await client.recoveryDiscard(session.docKey).catch(() => {})
        }
        return { kind: 'saved', session: nextSession }
      } catch (err) {
        if (isMobileCommandError(err) && err.code === 'PASSWORD_PROTECTED') {
          return { kind: 'failed', reason: 'protected' }
        }
        return {
          kind: 'failed',
          reason: 'write',
          detail: err instanceof Error ? err.message : String(err),
        }
      }
    },

    async shareDocument(session, editor, flags) {
      const editorProtected = await editor.isPasswordProtected().catch(() => true)
      if (flags.encrypted || flags.distribution || editorProtected) {
        // Encrypted / distribution HWP may ONLY share original untouched bytes.
        return client.shareFile({
          sessionId: session.sessionId,
          suggestedName: session.name,
          mode: 'original',
        })
      }
      const format: 'hwp' | 'hwpx' = session.format === 'hwpx' ? 'hwpx' : 'hwp'
      const bytes = format === 'hwpx' ? await editor.exportHwpx() : await editor.exportHwp()
      return client.shareFile({
        sessionId: session.sessionId,
        suggestedName: session.name,
        mode: 'edited',
        bytesBase64: bytesToBase64(bytes),
      })
    },

    async writeRecovery(session, editor, flags) {
      const editorProtected = await editor.isPasswordProtected().catch(() => true)
      if (flags.encrypted || flags.distribution || editorProtected) {
        throw new MobileCommandError({
          code: 'PASSWORD_PROTECTED',
          messageKey: 'hwpProtectedSaveError',
          detail: 'Encrypted or distribution HWP documents do not write recovery copies.',
        })
      }
      const format: 'hwp' | 'hwpx' = session.format === 'hwpx' ? 'hwpx' : 'hwp'
      const bytes = format === 'hwpx' ? await editor.exportHwpx() : await editor.exportHwp()
      return client.recoveryWrite({
        docKey: session.docKey,
        format,
        title: session.name,
        bytesBase64: bytesToBase64(bytes),
      })
    },

    async printPages() {
      return UNSUPPORTED_ON_MOBILE
    },
    async exportPdf() {
      return UNSUPPORTED_ON_MOBILE
    },
    async openHanjaDict() {
      return UNSUPPORTED_ON_MOBILE
    },
    async copyFormat() {
      return UNSUPPORTED_ON_MOBILE
    },
    async openMemoPanel() {
      return UNSUPPORTED_ON_MOBILE
    },
    async runDocCheck() {
      return UNSUPPORTED_ON_MOBILE
    },
  }
}
