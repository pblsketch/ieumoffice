// Send feedback from Settings > Help (track T6, spec 3.11): the same survey as the PC app, opened in
// the system browser. The app sends nothing itself; it only copies the details the user sees.
import { useEffect, useState } from 'react'
import { appInfo, openExternalUrl, type AppPlatform } from '@genoffice/mobile-bridge/home'
import type { MobileClient } from '@genoffice/mobile-bridge/transport'

/**
 * The published feedback survey. Must stay equal to FEEDBACK_SURVEY_URL in
 * apps/shell/src/main/feedback.ts (copied, not imported: the mobile app does not depend on the shell).
 */
export const FEEDBACK_SURVEY_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSfD_dlKfi_ZkcjBJFTH3S2nldTIoW0cMI9d_yDaEe6DwKY47A/viewform'

/** The app info with every field checked (test doubles answer unknown commands with `{ ok: true }`). */
export interface HelpAppInfo {
  /** The real app version, or null when the backend did not give one. */
  readonly version: string | null
  readonly platform: AppPlatform
  readonly osVersion: string
}

function normalizeAppInfo(raw: unknown): HelpAppInfo {
  const record: Record<string, unknown> =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const platform = record.platform
  return {
    version:
      typeof record.version === 'string' && record.version.trim() !== '' ? record.version : null,
    platform: platform === 'android' || platform === 'ios' ? platform : 'other',
    osVersion: typeof record.osVersion === 'string' ? record.osVersion.trim() : '',
  }
}

const infoByClient = new WeakMap<MobileClient, Promise<HelpAppInfo>>()

/** Reads the app info once per client; a failed read is not kept, so the next call asks again. */
export function loadAppInfo(client: MobileClient): Promise<HelpAppInfo> {
  const cached = infoByClient.get(client)
  if (cached) return cached
  const run = appInfo(client).then(normalizeAppInfo)
  infoByClient.set(client, run)
  run.catch(() => {
    if (infoByClient.get(client) === run) infoByClient.delete(client)
  })
  return run
}

/** The app info for a component: null while it loads, without a client, or when it fails. */
export function useAppInfo(client: MobileClient | null): HelpAppInfo | null {
  const [info, setInfo] = useState<{ client: MobileClient; info: HelpAppInfo } | null>(null)
  useEffect(() => {
    if (!client) return
    let alive = true
    loadAppInfo(client).then(
      (next) => {
        if (alive) setInfo({ client, info: next })
      },
      () => {
        // no version to show; the rows still work
      },
    )
    return () => {
      alive = false
    }
  }, [client])
  return info && info.client === client ? info.info : null
}

/** "Android 15", "iOS 18.1"; the OS version alone (or nothing) elsewhere. */
export function feedbackOsLabel(info: Pick<HelpAppInfo, 'platform' | 'osVersion'>): string {
  const name = info.platform === 'android' ? 'Android' : info.platform === 'ios' ? 'iOS' : ''
  return [name, info.osVersion].filter((part) => part !== '').join(' ')
}

/** Opens the survey in the system browser. Only an https address is ever handed over. */
export async function openFeedbackSurvey(client: MobileClient): Promise<void> {
  if (!FEEDBACK_SURVEY_URL.startsWith('https://')) {
    throw new Error('feedback survey address must be https')
  }
  await openExternalUrl(client, FEEDBACK_SURVEY_URL)
}
