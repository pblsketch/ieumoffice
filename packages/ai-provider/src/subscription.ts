/**
 * Shared plumbing for the subscription CLIs (Claude Code, Codex): locating the
 * program, reading its connection status, building its environment, starting
 * and stopping it. Entry point `@genoffice/ai-provider/subscription`.
 *
 * Main-process (Node) only. Renderer and preload code imports the IPC contract
 * from `@genoffice/ai-provider/browser` instead.
 */
export * from './subscription/contract'
export * from './connect-help'
export * from './subscription/env'
export * from './subscription/locate'
export * from './subscription/process'
export * from './subscription/leftovers'
export * from './subscription/status'
export * from './subscription/metered'
export * from './subscription/models'
export * from './subscription/service'
export * from './subscription/launch'
export * from './subscription/ipc'
// Side-effect registration of Antigravity ACP status, model list, and logout sources
export {
  ANTIGRAVITY_TEMP_PREFIX,
  antigravityAcpLaunchArgs,
  clearAntigravityModelCache,
  listAntigravitySubscriptionModels,
  logoutAntigravityAcp,
  parseAntigravityModels,
  parseAntigravityTier,
  probeAntigravityAcp,
} from './antigravity-acp'
