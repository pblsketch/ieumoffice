/**
 * Type definitions for the zero-dependency, linear-time backtracking-free
 * Thompson NFA / Pike VM regular expression engine.
 */

export declare const MAX_MACRO_REGEX_LENGTH: number
export declare const MAX_QUANTIFIER_BOUND: number

export interface CompileMacroRegexOptions {
  maxLength?: number
  maxQuantifier?: number
}

export interface MacroRegexRunOptions {
  onStep?: (delta: number) => void
  checkLimit?: () => void
}

export interface MacroRegexMatch {
  index: number
  length: number
  matchText: string
  groups: Array<string | undefined>
}

export interface CompiledMacroRegex {
  readonly pattern: string
  readonly flags: string
  readonly captureCount: number
  execAll(text: string, runOpts?: MacroRegexRunOptions): MacroRegexMatch[]
}

export declare function compileMacroRegex(
  pattern: string,
  flags?: string,
  options?: CompileMacroRegexOptions,
): CompiledMacroRegex

export declare function expandMacroRegexReplacement(
  template: string,
  match: MacroRegexMatch,
  fullText: string,
): string
