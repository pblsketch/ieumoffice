/**
 * Type definitions for the keystroke and editor command macro recorder.
 */

export declare const MACRO_SLOT_KEYS: readonly [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '0',
  '-',
]

export interface MacroRecordedStep {
  kind: 'text' | 'break' | 'nav' | 'edit' | 'command'
  code: string
  raw?: string
}

export interface MacroSkippedCommand {
  commandId: string
  label: string
}

export type MacroRecorderNotice =
  { kind: 'unsupported_command'; commandId: string; label: string } | { kind: 'mouse_ignored' }

export interface MacroRecorderStopResult {
  script: string
  stepCount: number
  skipped: MacroSkippedCommand[]
}

export interface MacroRecorderStateSnapshot {
  recording: boolean
  stepCount: number
  skipped: MacroSkippedCommand[]
}

export interface MacroRecorderOptions {
  onNotice?: (notice: MacroRecorderNotice) => void
}

export interface MacroKeyInput {
  key?: string
  code?: string
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

export interface MacroRecorder {
  start(): void
  stop(): MacroRecorderStopResult
  isRecording(): boolean
  getStepCount(): number
  getSkipped(): MacroSkippedCommand[]
  getSteps(): MacroRecordedStep[]
  getScript(): string
  recordText(text: string): boolean
  recordKey(keyEvent: MacroKeyInput): boolean
  recordCommand(commandId: string, args?: unknown, label?: string): boolean
  recordMouseMove(): boolean
}

export declare function slotFromAltKey(event: MacroKeyInput | null | undefined): number | null

export declare function quoteScriptString(text: string): string

export declare function createMacroRecorder(options?: MacroRecorderOptions): MacroRecorder

export declare function getActiveMacroRecorder(): MacroRecorder | null

export declare function setActiveMacroRecorder(recorder: MacroRecorder | null): MacroRecorder | null

export declare function isMacroRecordingActive(): boolean

export declare function recordStudioCommand(
  commandId: string,
  args?: unknown,
  label?: string,
): boolean

export declare function recordStudioText(text: string): boolean

export declare function recordStudioKey(keyEvent: MacroKeyInput): boolean

export declare function recordStudioMouseClick(): boolean
