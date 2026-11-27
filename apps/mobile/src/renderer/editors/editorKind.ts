import type { ComponentType } from 'react'
import type { AgentSkill } from '@genoffice/agent-core'
import type { Lang, Params } from '@genoffice/i18n'
import type { ActiveDocState } from '@genoffice/mobile-bridge/session-state'
import type {
  MobileClient,
  MobileDocFormat,
  MobileDocSession,
  MobileTheme,
} from '@genoffice/mobile-bridge/transport'
import type { DocumentMode } from '@genoffice/mobile-bridge/view-edit-gate'
import type { ToastRequest } from '../components/Toast'
import type { MobileStringKey } from '../i18n/strings'
import type { EditorShellProps } from '../shell/EditorShell'
import type { MobileWindowClass } from '../shell/useViewportLayout'

// Types only: the registry and the kind files both import these, so keeping them
// apart from registry.ts avoids an import cycle.

/** One kind of editor the app can open documents in (registered in registry.ts). */
export interface EditorKind {
  /** Stable id: 'hwp' | 'markdown' now; tracks use 'sheets' | 'pdf' | 'html' | 'epub' | 'pptx'. */
  readonly id: string
  readonly formats: readonly MobileDocFormat[]
  /** Extensions offered to the system picker and allowed by the open gate, in order. */
  readonly openExtensions: readonly string[]
  /** Formats the [+] sheet can create (untitled). Absent: none. */
  readonly createFormats?: readonly MobileDocFormat[]
  /** Name of the editor in lists (editor on/off in settings). */
  readonly labelKey?: MobileStringKey
  /** false: read-only kind — no edit mode, no save, no recovery copy. */
  readonly editable: boolean
  /** false: the AI entry points stay hidden for this kind even when AI is on. */
  readonly hasAi: boolean
  /** Format of the untitled session a recovery copy of `format` reopens in. */
  recoveryFormat(format: MobileDocFormat): MobileDocFormat
  /** Reads the document; runs before the session switch (which may ask to save). */
  open(request: EditorOpenRequest): Promise<EditorOpened>
}

export interface EditorOpenRequest {
  readonly session: MobileDocSession
  readonly client: MobileClient
  readonly isUntitled: boolean
  readonly recoveryBytesBase64?: string
}

export interface EditorOpened {
  /** The document is protected and must not be changed (the HWP rule: save and edited share refused).
   *  A kind that unlocks a file and lets it be edited leaves this unset. */
  readonly encrypted?: boolean
  readonly distribution?: boolean
  readonly trackingDropped?: boolean
  /** Banner when the document opens; null clears the banner. */
  readonly noticeKey: MobileStringKey | null
  /** Called once, after the session switch went through. */
  start(host: EditorHost): EditorDocument
  /** Called instead of start when the switch did not go through (the user kept the current document):
   *  free whatever open() prepared. */
  discard?(): void
}

/** PDF output produced by an editor for native printing or PDF sharing. */
export type EditorPdfExportResult =
  | {
      readonly kind: 'bytes'
      readonly bytes: Uint8Array
      readonly fileName: string
      /** Optional non-fatal notice shown after export (e.g. missing glyphs). */
      readonly noticeKey?: MobileStringKey
    }
  | {
      /** Unmodified PDF session: Rust copies and prints directly from the original URI. */
      readonly kind: 'session-original'
      readonly fileName: string
    }

/** One opened document. Lives in App for as long as the document is active,
 *  also while its Workspace is not mounted (e.g. on the settings screen). */
export interface EditorDocument {
  save?(doc: ActiveDocState, forceSaveAs: boolean): Promise<boolean>
  share(doc: ActiveDocState): Promise<void>
  /** Produces PDF bytes (or marks an unmodified PDF session) for printing or PDF sharing. */
  exportPdf?(doc: ActiveDocState, target: 'print' | 'share'): Promise<EditorPdfExportResult | null>
  /** Labels print/PDF actions for scoped editors (EPUB chapter, Sheets active sheet). Defaults to 'document'. */
  readonly exportPdfScope?: 'document' | 'chapter' | 'sheet'
  writeRecovery?(doc: ActiveDocState): Promise<void>
  /** Throws when the tools cannot be prepared (shown as a connection error). */
  createAiRun?(ctx: EditorAiContext): Promise<EditorAiRun>
  /** Created once per document; renders EditorShell with `frame` plus its own bars and sheets. */
  readonly Workspace: ComponentType<EditorWorkspaceProps>
  /** false: this document is read-only even though its kind can edit. */
  readonly editable?: boolean
  /** false: the AI entry points stay hidden for this document (e.g. a file opened with a password). */
  readonly aiAvailable?: boolean
  /** Called once when the document is closed or replaced by another: free engines, delete temp files. */
  dispose?(): void
}

export interface EditorWorkspaceProps {
  readonly frame: EditorFrameProps
  readonly mode: DocumentMode
  readonly canEdit: boolean
  readonly lang: Lang
  readonly theme: MobileTheme
}

/** The EditorShell props App owns. */
export type EditorFrameProps = Omit<
  EditorShellProps,
  | 'quickActions'
  | 'formatGroups'
  | 'insertItems'
  | 'moreItems'
  | 'morePairs'
  | 'viewTools'
  | 'onFitToWidth'
  | 'children'
>

/** What App lends an opened document. */
export interface EditorHost {
  readonly client: MobileClient
  markDirty(dirty: boolean): void
  updateSession(meta: { session: MobileDocSession; dirty: boolean; isUntitled: boolean }): void
  setNotice(text: string | null): void
  /** What Toast.tsx's showToast takes. */
  showToast(input: ToastRequest | string): void
  /** Content changed (every keystroke, AI edit, undo): App restarts the 2 s recovery timer. */
  contentChanged(): void
  refreshHome(): Promise<void>
  openSession(session: MobileDocSession): Promise<void>
  translate(key: MobileStringKey, params?: Params): string
  /** From shell/useViewportLayout.ts. */
  windowClass(): MobileWindowClass
}

export interface EditorAiContext {
  getMode(): DocumentMode
  getCapabilities(): {
    writable: boolean
    encrypted: boolean
    distribution: boolean
    isUntitled: boolean
  }
  switchToEdit(): void
  setUndo(entry: { summary: string; undo: () => void } | null): void
  getLang(): Lang
}

export interface EditorAiRun {
  readonly skill: AgentSkill
  /** After the run ends (done, error or stop). */
  finish?(): void
}
