import type { AgentToolCall } from './types'
import { isMcpToolName } from './user-mcp/names'

/**
 * Tools that always send model-chosen text to, or fetch from, somewhere off the PC.
 * Image placement tools (`insert_image`, `insert_web_image`, `add_image`, etc.) are
 * gated by `fetchesAddress(call.input)` instead so local `attachment://` and
 * app-cached `file://` images can still be embedded without reaching the network.
 */
export const OUTBOUND_TOOLS: ReadonlySet<string> = new Set([
  'web_search',
  'image_search',
  'generate_image',
  'transform_image',
  'remove_image_background',
  'analyze_media',
  'read_url',
  'search_references',
])

/** Input fields an editor fetches when they hold a web address */
const FETCHED_FIELDS = new Set(['url', 'src', 'imageUrl', 'image_url'])

function fetchesAddress(value: unknown, depth = 0): boolean {
  if (depth > 6 || value === null || typeof value !== 'object') return false
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (FETCHED_FIELDS.has(key) && typeof inner === 'string' && /^\s*https?:/i.test(inner)) {
      return true
    }
    if (typeof inner === 'object' && fetchesAddress(inner, depth + 1)) return true
  }
  return false
}

/**
 * Whether a tool reaches off the PC by its name alone: the outbound tools and
 * every user MCP server's tool (`mcp__` prefix, user MCP spec 7.2), unless
 * `isLocalOnlyTool` marks it as an app-built-in local-only connector (such as
 * Obsidian vaults) that stays on this PC.
 */
export function isOutboundToolName(
  name: string,
  isLocalOnlyTool?: (name: string) => boolean,
): boolean {
  if (OUTBOUND_TOOLS.has(name)) return true
  if (isMcpToolName(name)) return !isLocalOnlyTool?.(name)
  return false
}

/** Whether a call would carry text or an address off the PC */
export function isOutboundCall(
  call: AgentToolCall,
  isLocalOnlyTool?: (name: string) => boolean,
): boolean {
  return isOutboundToolName(call.name, isLocalOnlyTool) || fetchesAddress(call.input)
}
