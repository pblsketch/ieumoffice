/**
 * The PDF tools screen as the home's tracks see it (spec 5.1, 9). The types
 * have the same shape as T6's home/pdfToolsLink.ts, so once T6 is merged
 * `providePdfToolsLink(pdfToolsLink)` in home/ToolsTab.tsx type-checks as is.
 *
 * The screen itself (flow/Flow.tsx) checks options with @genoffice/pdf-ops,
 * which brings pdf-lib along, so it is a chunk loaded on first use: the home
 * keeps its start-up size.
 */
import { createElement, lazy, Suspense, type ComponentType } from 'react'
import type { HomeHost } from '../home/homeHost'
import type { MobilePdfToolId } from './catalog'

export interface PdfToolInput {
  /** File name, extension included. */
  readonly name: string
  /** 'application/pdf' | 'image/jpeg' | … */
  readonly mime: string
  readonly sizeBytes?: number
  /** Reads on every call, so a tool can read its inputs one at a time. */
  readBytes(): Promise<Uint8Array>
}

export type PdfToolStart =
  /** The tools list. */
  | { readonly kind: 'menu' }
  /** Merge, in the order the files were picked. */
  | { readonly kind: 'merge'; readonly inputs: readonly PdfToolInput[] }
  | { readonly kind: 'imagesToPdf'; readonly inputs: readonly PdfToolInput[] }

export interface PdfToolFlowProps {
  readonly host: HomeHost
  readonly start: PdfToolStart
  /** T3 calls this when the tools screen closes (back included). */
  readonly onClose: () => void
}

export interface PdfToolsLink {
  readonly Flow: ComponentType<PdfToolFlowProps>
}

/** Where the screen starts: T6's starts, or one tool's files (the home [Tools] tab) */
export type PdfToolsFlowStart =
  PdfToolStart | { readonly kind: 'tool'; readonly tool: MobilePdfToolId }

/** The screen's props: T6's, with the [Tools] tab's own start added */
export interface PdfToolsFlowProps extends Omit<PdfToolFlowProps, 'start'> {
  readonly start: PdfToolsFlowStart
}

const FlowScreen = lazy(() => import('./flow/Flow'))

/** The full-screen PDF tools layer; its code loads the first time it opens */
export function PdfToolsFlow(props: PdfToolsFlowProps) {
  return createElement(
    Suspense,
    {
      fallback: createElement('div', {
        className: 'pdf-tools-flow',
        'aria-busy': 'true',
        'data-testid': 'pdf-tools-flow-loading',
      }),
    },
    createElement(FlowScreen, props),
  )
}

/** The value T6's providePdfToolsLink takes (wired when T6 is merged) */
export const pdfToolsLink: PdfToolsLink = { Flow: PdfToolsFlow }
