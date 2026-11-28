/**
 * The slots the spreadsheet document is put together from (XLS-T7). Each
 * later task fills its own area's files and none of them edits the
 * Workspace or the document itself:
 *
 * - `grid/workspaceSlot.tsx` (XLS-T8), `toolbar/workspaceSlot.tsx` (XLS-T9),
 *   `save/workspaceSlot.tsx` (XLS-T10), `ai/workspaceSlot.tsx` (XLS-T11):
 *   a hook returning that area's toolbar groups, format sheets, view tools,
 *   More items and overlays. `SheetsWorkspace.tsx` calls them in that order
 *   and joins what they return.
 * - `save/documentSlot.ts` (XLS-T10): save, share and recovery copy.
 * - `ai/documentSlot.ts` (XLS-T11): `createAiRun`.
 *
 * See editors/sheets/README-slots.md for the full list.
 */
import type { ReactNode } from 'react'
import type { Lang } from '@genoffice/i18n'
import type { DocumentMode } from '@genoffice/mobile-bridge/view-edit-gate'
import type { MobileTheme } from '@genoffice/mobile-bridge/transport'
import type { MobileStringKey } from '../../../i18n'
import type { EditorFormatGroup, EditorQuickActionItem } from '../../../shell/EditorShell'
import type { EditorHost } from '../../editorKind'
import type { SheetsGridHandle } from '../grid/SheetsGridView'
import type { MobileGrid } from '../grid/mobileGrid'
import type { OpenedSheetsWorkbook } from '../session'

/**
 * The open document's grid, once the lazy grid chunk built it. `grid` lives
 * as long as the document (the document's `dispose()` tears it down);
 * `handle` is set while the grid view is on screen.
 */
export interface SheetsGridAccess {
  grid: MobileGrid | null
  handle: SheetsGridHandle | null
}

/** What every document-level slot gets (save, share, recovery, AI run). */
export interface SheetsDocumentContext {
  readonly host: EditorHost
  readonly opened: OpenedSheetsWorkbook
  readonly grid: SheetsGridAccess
}

/** What every Workspace slot hook gets, on each render. */
export interface SheetsWorkspaceContext extends SheetsDocumentContext {
  readonly mode: DocumentMode
  readonly canEdit: boolean
  readonly lang: Lang
  readonly theme: MobileTheme
  readonly t: (key: MobileStringKey) => string
}

/** One area's share of the editor screen (all optional). */
export interface SheetsWorkspaceItems {
  /** Edit toolbar buttons (undo/redo go to the app bar). */
  readonly quickActions?: readonly EditorQuickActionItem[]
  /** Groups of the format panel. */
  readonly formatGroups?: readonly EditorFormatGroup[]
  /** View-mode tools of the document area. */
  readonly viewTools?: readonly EditorQuickActionItem[]
  /** Rows of the More sheet. */
  readonly moreItems?: readonly EditorQuickActionItem[]
  /** Bars, sheets and panels this area draws over the grid. */
  readonly overlay?: ReactNode
}

/** A React hook: called on every render of the Workspace, always in the same order. */
export type SheetsWorkspaceSlot = (context: SheetsWorkspaceContext) => SheetsWorkspaceItems

/** Joins the areas' items in slot order. */
export function joinWorkspaceItems(parts: readonly SheetsWorkspaceItems[]): {
  quickActions: EditorQuickActionItem[]
  formatGroups: EditorFormatGroup[]
  viewTools: EditorQuickActionItem[]
  moreItems: EditorQuickActionItem[]
  overlays: ReactNode[]
} {
  return {
    quickActions: parts.flatMap((part) => part.quickActions ?? []),
    formatGroups: parts.flatMap((part) => part.formatGroups ?? []),
    viewTools: parts.flatMap((part) => part.viewTools ?? []),
    moreItems: parts.flatMap((part) => part.moreItems ?? []),
    overlays: parts.flatMap((part) => (part.overlay === undefined ? [] : [part.overlay])),
  }
}
