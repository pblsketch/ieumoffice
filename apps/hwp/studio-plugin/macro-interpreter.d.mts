/**
 * Type definitions for the restricted synchronous script macro interpreter.
 */

export declare const MAX_INT32: number

export interface MacroLimits {
  readonly maxTimeMs: number
  readonly maxSteps: number
  readonly maxCallDepth: number
  readonly maxStringLength: number
  readonly maxCollectionSize: number
  readonly maxScriptBytes: number
  readonly maxMemoryBytes: number
}

export type MacroLimitsInput = Partial<{
  maxTimeMs: number
  maxSteps: number
  maxCallDepth: number
  maxStringLength: number
  maxCollectionSize: number
  maxScriptBytes: number
  maxMemoryBytes: number
}>

export declare const DEFAULT_MACRO_LIMITS: Readonly<MacroLimits>

export declare const FORBIDDEN_PROP_NAMES: ReadonlySet<string>

export declare const BIDI_AND_INVISIBLE_RE: RegExp

export interface DisallowedInvisibleCharMatch {
  line: number
  column: number
  codePoint: number
  hex: string
}

export declare function findDisallowedInvisibleChar(
  source: string,
): DisallowedInvisibleCharMatch | null

export interface InterpreterCapabilities {
  readonly keywords: readonly string[]
  readonly globals: readonly string[]
  readonly stringMethods: readonly string[]
  readonly arrayMethods: readonly string[]
  readonly objectMethods: readonly string[]
  readonly mathMethods: readonly string[]
  readonly mathConstants: readonly string[]
  readonly jsonMethods: readonly string[]
  readonly numberMethods: readonly string[]
  readonly arrayStaticMethods: readonly string[]
}

export declare const INTERPRETER_CAPABILITIES: Readonly<InterpreterCapabilities>

export type MacroSyntaxErrorCode = 'syntax_error' | 'script_too_large'

export type MacroRuntimeErrorCode =
  | 'step_limit'
  | 'time_limit'
  | 'call_depth_limit'
  | 'memory_limit'
  | 'forbidden_property'
  | 'unknown_identifier'
  | 'type_error'
  | 'runtime_error'

export type MacroErrorCode = MacroSyntaxErrorCode | MacroRuntimeErrorCode

export declare class MacroSyntaxError extends Error {
  readonly code: MacroSyntaxErrorCode
  readonly line: number
  readonly column: number
  constructor(message: string, line?: number, column?: number, code?: MacroSyntaxErrorCode)
}

export declare class MacroRuntimeError extends Error {
  readonly code: MacroRuntimeErrorCode
  readonly line: number
  readonly column: number
  constructor(message: string, code?: MacroRuntimeErrorCode, line?: number, column?: number)
}

export interface MacroAstNode {
  type: string
  line: number
  column: number
  [key: string]: unknown
}

export interface MacroProgramNode extends MacroAstNode {
  type: 'Program'
  body: MacroAstNode[]
}

export interface MacroParseOptions extends MacroLimitsInput {
  limits?: MacroLimitsInput
}

export interface MacroBudgetHandle {
  addSteps(count: number): void
  checkLimits(): void
}

export interface MacroRunOptions extends MacroParseOptions {
  now?: () => number
  startTime?: number
  onRegisterBudget?: (budget: MacroBudgetHandle) => void
}

export interface MacroParseSuccess {
  ok: true
  ast: MacroProgramNode
}

export interface MacroParseFailure {
  ok: false
  code: MacroSyntaxErrorCode
  error: string
  line: number
  column: number
}

export type MacroParseResult = MacroParseSuccess | MacroParseFailure

export type MacroValidateSyntaxResult =
  | { ok: true }
  | {
      ok: false
      code: MacroSyntaxErrorCode
      error: string
      line: number
      column: number
    }

export interface MacroRunSuccess {
  ok: true
  value: unknown
  steps: number
  elapsedMs: number
}

export interface MacroRunFailure {
  ok: false
  code: MacroErrorCode
  error: string
  line: number
  column: number
  steps: number
  elapsedMs: number
}

export type MacroRunResult = MacroRunSuccess | MacroRunFailure

export declare function validateMacroLimits(limits?: MacroLimitsInput | null): Readonly<MacroLimits>

export declare function parseMacroScript(
  source: string,
  options?: MacroParseOptions,
): MacroParseResult

export declare function validateMacroSyntax(
  source: string,
  options?: MacroParseOptions,
): MacroValidateSyntaxResult

export declare function createSafeBag<T extends Record<string, unknown> = Record<string, unknown>>(
  initial?: T | null,
  limits?: MacroLimitsInput,
): T

export declare function sanitizeHostValue(value: unknown, limits?: MacroLimitsInput): unknown

export declare function runMacroScript(
  source: string,
  globals?: Record<string, unknown> | null,
  options?: MacroRunOptions,
): MacroRunResult
