/**
 * What the tools screens take from their surroundings: which formats an
 * editor of this app opens, and how the engine is made. Both have app
 * defaults; tests hand in their own through PdfToolsEnvProvider.
 */
import { createContext, createElement, useContext, type ReactNode } from 'react'
import { EDITOR_KINDS } from '../editors/registry'
import type { PdfToolsEngine } from './engine/types'

export interface PdfToolsEnv {
  /** Whether an editor kind of this app opens files ending in `ext` ('pdf', 'txt') */
  readonly editorOpens?: (ext: string) => boolean
  /** The engine of one tools screen; by default the bundled worker engine */
  readonly createEngine?: () => PdfToolsEngine
}

/** Whether a registered editor kind opens `ext` */
export function registryOpens(ext: string): boolean {
  return EDITOR_KINDS.some((kind) => kind.openExtensions.includes(ext))
}

const PdfToolsEnvContext = createContext<PdfToolsEnv>({})

export function PdfToolsEnvProvider({
  value,
  children,
}: {
  readonly value: PdfToolsEnv
  readonly children?: ReactNode
}) {
  return createElement(PdfToolsEnvContext.Provider, { value }, children)
}

export function usePdfToolsEnv(): PdfToolsEnv {
  return useContext(PdfToolsEnvContext)
}

/** `editorOpens` of the env, or the registry's answer */
export function useEditorOpens(): (ext: string) => boolean {
  return usePdfToolsEnv().editorOpens ?? registryOpens
}
