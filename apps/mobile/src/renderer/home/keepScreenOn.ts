// Keeps the screen on while a reading screen is visible (spec 3.15). Tracks T2 and T5 call the hook
// from their reading screens; the count covers several screens at once. Nothing happens while the
// setting is off, and the screen is let go while the app is in the background.
import { useEffect } from 'react'
import { invokeMobileCommand, type MobileClient } from '@genoffice/mobile-bridge/transport'
import { ensureLoaded, getHomePrefs, subscribeHomePrefs } from './prefsStore'

const KEEP_SCREEN_ON_COMMAND = 'mobile_home_keep_screen_on'

let holders = 0
// What the OS was last asked for.
let applied = false
let lastClient: MobileClient | null = null
let unbind: (() => void) | null = null

function wanted(): boolean {
  if (holders === 0 || !getHomePrefs().keepScreenOnWhileReading) return false
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

function sync(): void {
  const on = wanted()
  if (on === applied) return
  applied = on
  const client = lastClient
  if (!client) return
  // a platform without the command (or a test double) refuses; the screen just follows the OS
  void invokeMobileCommand(client.transport, KEEP_SCREEN_ON_COMMAND, { on }).catch(() => {})
}

function bind(): void {
  if (unbind) return
  const stopPrefs = subscribeHomePrefs(sync)
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', sync)
  unbind = () => {
    stopPrefs()
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', sync)
  }
}

function hold(client: MobileClient): void {
  lastClient = client
  holders += 1
  bind()
  sync()
  // the stored setting may say off; the store re-syncs when the read lands
  void ensureLoaded(client)
}

function letGo(): void {
  holders = Math.max(0, holders - 1)
  sync()
  if (holders === 0 && unbind) {
    unbind()
    unbind = null
  }
}

/** Call from a reading screen; `active` is whether that screen is showing now. */
export function useKeepScreenOn(client: MobileClient, active: boolean): void {
  useEffect(() => {
    if (!active) return
    hold(client)
    return letGo
  }, [client, active])
}

/** Tests only: forgets the holders without calling the backend. */
export function resetKeepScreenOnForTest(): void {
  unbind?.()
  unbind = null
  holders = 0
  applied = false
  lastClient = null
}
