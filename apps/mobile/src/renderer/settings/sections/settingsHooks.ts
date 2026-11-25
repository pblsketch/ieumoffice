// Owner: track T6. Hooks the settings sections share.
import { useEffect, useState } from 'react'
import { appInfo, type AppInfo } from '@genoffice/mobile-bridge/home'
import type { MobileClient } from '@genoffice/mobile-bridge/transport'
import { ensureLoaded, useHomePrefs, type HomePrefsView } from '../../home/prefsStore'
import { useHomeRuntime } from '../../home/homeRuntime'

const PLATFORMS: readonly string[] = ['android', 'ios', 'other']

function readAppInfo(raw: unknown): AppInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (typeof record.version !== 'string' || record.version.trim() === '') return null
  const platform =
    typeof record.platform === 'string' && PLATFORMS.includes(record.platform)
      ? (record.platform as AppInfo['platform'])
      : 'other'
  const osVersion = typeof record.osVersion === 'string' ? record.osVersion : ''
  return { version: record.version.trim(), platform, osVersion }
}

/** The app's version and platform once the backend answered; null before, without a client, or on failure. */
export function useAppInfo(client: MobileClient | null): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    if (!client) {
      setInfo(null)
      return
    }
    let alive = true
    appInfo(client).then(
      (raw) => {
        if (alive) setInfo(readAppInfo(raw))
      },
      () => {
        if (alive) setInfo(null)
      },
    )
    return () => {
      alive = false
    }
  }, [client])
  return info
}

/** The home settings for a settings row; starts the first read when a runtime host is there. */
export function useSettingsPrefs(): HomePrefsView {
  const runtime = useHomeRuntime()
  const view = useHomePrefs()
  useEffect(() => {
    void ensureLoaded(runtime?.client ?? null)
  }, [runtime])
  return view
}
