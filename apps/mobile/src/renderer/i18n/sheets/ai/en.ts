import type { zh } from './zh'

export const en = {
  sheetsAiUndoRefused: "The sheet was edited after the AI's changes, so they were not undone.",
  sheetsAiUndoPartial: "Some of the AI's changes could not be undone. Please check the sheet.",
  sheetsAiUndoExpired:
    "The AI's changes can no longer be undone in one step (the workbook was saved or edited a lot since). Use Undo instead.",
} as const satisfies Record<keyof typeof zh, string>
