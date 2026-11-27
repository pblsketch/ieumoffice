/**
 * Type definitions for the macro compatibility object (`HAction` and `HParameterSet`).
 */

import type { MacroLimitsInput } from './macro-interpreter.d.mts'
import type { MacroDocumentApi, MacroExecutionState } from './macro-host.d.mts'

export declare const SUPPORTED_COMPAT_ACTIONS: ReadonlySet<string>
export declare const REFUSED_COMPAT_ACTIONS: ReadonlySet<string>

export interface CompatParameterBag {
  HSet: CompatParameterBag
  [key: string]: unknown
}

export interface CompatParameterSetNamespace {
  readonly HInsertText: CompatParameterBag
  readonly HCharShape: CompatParameterBag
  readonly HParaShape: CompatParameterBag
  readonly HStyle: CompatParameterBag
  readonly HFindReplace: CompatParameterBag
  readonly HTableCreation: CompatParameterBag
  readonly HSelectionOpt: CompatParameterBag
}

export interface CompatActionNamespace {
  GetDefault(actionName: string, pset?: CompatParameterBag | null): boolean
  Execute(actionName: string, pset?: CompatParameterBag | null): unknown
  Run(actionName: string): unknown
}

export interface CompatGlobals {
  readonly HAction: CompatActionNamespace
  readonly HParameterSet: CompatParameterSetNamespace
}

export interface CreateCompatGlobalsOptions {
  limits?: MacroLimitsInput
  state?: MacroExecutionState | null
}

export declare function createCompatGlobals(
  api: MacroDocumentApi,
  options?: CreateCompatGlobalsOptions,
): CompatGlobals
