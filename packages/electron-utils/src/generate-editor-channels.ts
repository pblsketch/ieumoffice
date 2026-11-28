/**
 * Preload-safe IPC channel constants for opening the shell Generate Window
 * from an editor tab without trusting any renderer-supplied file path.
 */
export const GENERATE_EDITOR_CHANNELS = {
  openForCurrentTab: 'generate-editor:open-for-current-tab',
} as const

export interface GenerateEditorOpenResult {
  readonly ok: boolean
  readonly reason?: 'unavailable' | 'unsaved' | 'not-found' | undefined
}

export interface GenerateEditorBridge {
  openForCurrentTab(): Promise<GenerateEditorOpenResult>
}
