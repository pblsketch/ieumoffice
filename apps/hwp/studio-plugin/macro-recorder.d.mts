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
  | { kind: 'unsupported_command'; commandId: string; label: string }
  | { kind: 'mouse_ignored' }
  | { kind: 'outside_body_ignored' }
  | { kind: 'slot_run_ignored'; slot: number }

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
  isComposing?: boolean
  keyCode?: number
  target?: unknown
  preventDefault?: () => void
}

export interface MacroRecordContext {
  inBody?: boolean
}

export interface MacroKeyRecordContext extends MacroRecordContext {
  hadSelection?: boolean
  navigationAction?: string
  adjacentObject?: boolean
}

export interface MacroCharToggleState {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
}

export interface MacroRecorder {
  start(): void
  stop(): MacroRecorderStopResult
  isRecording(): boolean
  getStepCount(): number
  getSkipped(): MacroSkippedCommand[]
  getSteps(): MacroRecordedStep[]
  getScript(): string
  recordText(text: string, context?: MacroRecordContext): boolean
  recordKey(keyEvent: MacroKeyInput, context?: MacroKeyRecordContext): boolean
  recordCommand(
    commandId: string,
    args?: unknown,
    label?: string,
    formatState?: MacroCharToggleState,
    context?: MacroRecordContext,
  ): boolean
  recordMouseMove(): boolean
  recordSlotRun(slot: number): boolean
}

export declare const PROTECTED_CONTENT_CTRL_IDS: ReadonlySet<string>

export interface ProtectedDeletionRange {
  startSec: number
  startPara: number
  startOffset: number
  endSec: number
  endPara: number
  endOffset: number
}

export interface ProtectedDeletionBlocker {
  code: 'object_loss' | 'memo_loss'
  message: string
  ctrlId?: string
}

export declare function findProtectedDeletionBlocker(
  docOrBridge: unknown,
  range: ProtectedDeletionRange,
): ProtectedDeletionBlocker | null

export declare function findProtectedStepDeletionBlocker(
  docOrBridge: unknown,
  pos: unknown,
  direction: 'backward' | 'forward',
  count?: number,
): ProtectedDeletionBlocker | null

export declare function hasAdjacentProtectedObject(
  wasm: unknown,
  pos: unknown,
  key: string,
): boolean

export declare function slotFromAltKey(event: MacroKeyInput | null | undefined): number | null

export declare function quoteScriptString(text: string): string

export declare function createMacroRecorder(options?: MacroRecorderOptions): MacroRecorder

export declare function setAssignedMacroSlots(slots: Iterable<number> | null | undefined): number[]

export declare function hasAssignedMacroSlot(slot: number): boolean

export declare function getActiveMacroRecorder(): MacroRecorder | null

export declare function setActiveMacroRecorder(recorder: MacroRecorder | null): MacroRecorder | null

export declare function isMacroRecordingActive(): boolean

export declare function recordStudioCommand(
  commandId: string,
  args?: unknown,
  label?: string,
  formatState?: MacroCharToggleState,
  context?: MacroRecordContext,
): boolean

export declare function recordStudioText(text: string, context?: MacroRecordContext): boolean

export declare function recordStudioKey(
  keyEvent: MacroKeyInput,
  context?: MacroKeyRecordContext,
): boolean

export declare function recordStudioMouseClick(): boolean

export declare function recordStudioSlotRun(slot: number): boolean
