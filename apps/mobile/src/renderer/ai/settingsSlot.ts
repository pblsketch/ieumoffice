/**
 * Opaque AI settings slot. The AI settings hook (track T7) produces this
 * object; SettingsScreen passes it through to AiSection and AiStorageRows
 * untouched, so T7 can grow the AI settings without editing App or
 * SettingsScreen.
 */
export type MobileAiSettingsSlot = Readonly<Record<string, unknown>>
