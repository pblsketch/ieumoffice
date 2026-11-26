// Keeps the screen on while a reader is showing, through track T6's hook when that track is present.
// T6 adds apps/mobile/src/renderer/home/keepScreenOn.ts (`useKeepScreenOn(client, active)`); until then
// the glob below finds nothing and the reader hook does nothing. The choice is made once at module load,
// so every render calls the same function and the rules of hooks hold.
import type { MobileClient } from '@genoffice/mobile-bridge/transport'

export type KeepScreenOnHook = (client: MobileClient, active: boolean) => void

const noKeepScreenOn: KeepScreenOnHook = () => {}

/** Returns T6's `useKeepScreenOn` from a glob module map when one module exports it, otherwise a no-op hook. */
export function pickKeepScreenOn(modules: Record<string, unknown>): KeepScreenOnHook {
  for (const mod of Object.values(modules)) {
    if (!mod || typeof mod !== 'object') continue
    const hook = (mod as { readonly useKeepScreenOn?: unknown }).useKeepScreenOn
    if (typeof hook === 'function') return hook as KeepScreenOnHook
  }
  return noKeepScreenOn
}

/** Call from a reading screen; `active` is whether that screen is showing now. */
export const useReaderKeepScreenOn: KeepScreenOnHook = pickKeepScreenOn(
  import.meta.glob('../../../home/keepScreenOn.ts', { eager: true }),
)
