import type { MobileAiSettingsSnapshot, MobileClient } from '@genoffice/mobile-bridge/transport'

/**
 * The AI settings slot. The AI settings hook (useMobileAi, track T7) produces
 * this object; SettingsScreen passes it through to AiSection and AiStorageRows
 * untouched, so T7 can grow the AI settings without editing App or
 * SettingsScreen. Every field is optional: without a slot (a bare settings
 * screen in a test) the rows that need the client are not drawn.
 *
 * The run state is not here: the settings read the module store in
 * `ai/runState.ts`. The AI tool settings live in `ai/tools/state.ts`.
 */
export interface MobileAiSettingsSlot {
  /** The app's client: the self-hosted server, the relay and the AI result store commands. */
  readonly client?: MobileClient
  /** Hands Rust's latest AI settings snapshot to the AI state (the AI sheet and model chip). */
  readonly applyAiSettings?: (snapshot: MobileAiSettingsSnapshot) => void
}
