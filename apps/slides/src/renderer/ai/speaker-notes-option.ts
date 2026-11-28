/**
 * Opt-in slide speaker-notes separation helper (T11).
 * Default is OFF (`false`): returns an empty string so the baseline page system
 * prompt stays byte-identical unless the user explicitly enables the option.
 */

export const SPEAKER_NOTES_SEPARATE_DEFAULT = false

export const SPEAKER_NOTES_SEPARATE_DIRECTIVE =
  'Speaker-notes separation mode is ON: keep on-slide copy ultra-concise (headline + 2-4 short key phrases or numbers) and place detailed explanations, talking points, and supporting context into each slide speaker notes.'

export function speakerNotesPromptAddition(enabled: boolean | undefined): string {
  return enabled === true ? `\n\n${SPEAKER_NOTES_SEPARATE_DIRECTIVE}` : ''
}
