/**
 * Shared contract for the Global Quick Switcher popup window (`Ctrl+Shift+P` / `Cmd+Shift+P`).
 * Renderer only returns shell-issued `itemId`s to `execute`; main validates against the active query map.
 */

export const QUICK_SWITCHER_ACCELERATOR = 'CommandOrControl+Shift+P'

export const QUICK_SWITCHER_CHANNELS = {
  query: 'quick-switcher:query',
  execute: 'quick-switcher:execute',
  close: 'quick-switcher:close',
  lang: 'quick-switcher:lang',
  theme: 'quick-switcher:theme',
} as const

export type QuickSwitcherGroup = 'open-tab' | 'recent-file' | 'project-file' | 'command'

export interface QuickSwitcherItem {
  readonly id: string
  readonly group: QuickSwitcherGroup
  readonly title: string
  readonly subtitle?: string | undefined
  readonly editorKind?: string | undefined
  readonly badge?: string | undefined
}

export interface QuickSwitcherQueryResult {
  readonly items: readonly QuickSwitcherItem[]
  readonly aiVisible: boolean
}

export interface QuickSwitcherBridge {
  query(q: string): Promise<QuickSwitcherQueryResult>
  execute(itemId: string): Promise<boolean>
  close(): Promise<void>
  lang(): Promise<string>
  theme(): Promise<'light' | 'dark' | 'system'>
}
