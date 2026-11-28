/**
 * Preload-safe bridge for opening the shell Generate Window from an editor tab.
 * Shell main resolves the caller `event.sender`'s actual open tab file path;
 * no path ever crosses from renderer to main.
 */
import { ipcRenderer } from 'electron'
import {
  GENERATE_EDITOR_CHANNELS,
  type GenerateEditorBridge,
  type GenerateEditorOpenResult,
} from './generate-editor-channels'

const unavailable = (): GenerateEditorOpenResult => ({ ok: false, reason: 'unavailable' })

export function generateEditorBridge(): GenerateEditorBridge {
  return {
    openForCurrentTab: () =>
      ipcRenderer
        .invoke(GENERATE_EDITOR_CHANNELS.openForCurrentTab)
        .then(
          (raw): GenerateEditorOpenResult =>
            raw && typeof raw === 'object' && typeof (raw as { ok?: unknown }).ok === 'boolean'
              ? (raw as GenerateEditorOpenResult)
              : unavailable(),
          unavailable,
        ),
  }
}
