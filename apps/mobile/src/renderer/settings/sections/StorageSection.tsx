// Owner: track T6 (storage). Draws the AI result store rows that T7 owns.
import type { MobileAiSettingsSlot } from '../../ai/settingsSlot'
import { AiStorageRows } from './AiSection'

export interface StorageSectionProps {
  readonly aiSlot?: MobileAiSettingsSlot
}

export function StorageSection({ aiSlot }: StorageSectionProps) {
  // No wrapper yet: while AiStorageRows draws nothing, this adds no DOM node.
  return <AiStorageRows slot={aiSlot} />
}
