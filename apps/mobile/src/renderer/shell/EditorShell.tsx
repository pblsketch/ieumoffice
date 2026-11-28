import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AiMark } from '@genoffice/ui'
import type { DocumentMode } from '@genoffice/mobile-bridge/view-edit-gate'
import type { MobileDocFormat } from '@genoffice/mobile-bridge/transport'
import { useMobileLocale } from '../i18n'
import { Sheet } from '../components/Sheet'
import { HomePrintIcon, HomeSharePdfIcon } from '../components/icons/home'
import {
  DocTypeIcon,
  IconBack,
  IconBold,
  IconCheck,
  IconClose,
  IconEdit,
  IconFitWidth,
  IconFlowView,
  IconHeading,
  IconHistory,
  IconImage,
  IconItalic,
  IconKeyboardHide,
  IconList,
  IconLock,
  IconMemo,
  IconNumberedList,
  IconTable,
  IconMore,
  IconPageView,
  IconPlus,
  IconRedo,
  IconSave,
  IconShare,
  IconTextBigger,
  IconTextFormat,
  IconTextSmaller,
  IconUnderline,
  IconUndo,
  IconUnlock,
} from '../components/MobileIcons'
import { useBackLayer } from './backStack'
import { useViewportLayout } from './useViewportLayout'

export interface EditorQuickActionItem {
  readonly id: string
  readonly label: string
  readonly onPress: () => void
  /** Drawn instead of the built-in icon for `id` (lets a kind bring its own icons). */
  readonly icon?: ReactNode
  /** Renders the view tool as a labeled pill so key mode switches stay easy to spot. */
  readonly showLabel?: boolean
  /** Section placement inside the [⋯] More sheet (defaults to 'document'). */
  readonly section?: 'file' | 'document'
}

/** One quick action inside a paired row in the [⋯] More sheet. */
export interface EditorMorePairAction {
  readonly id: string
  readonly label: string
  readonly active?: boolean
  readonly icon?: ReactNode
  readonly onPress: () => void
}

/** A compact row in [⋯] with a label on the left and paired quick buttons on the right. */
export interface EditorMorePair {
  readonly id: string
  readonly label: string
  readonly section?: 'file' | 'document'
  readonly actions: readonly EditorMorePairAction[]
}

/** One titled group in the format panel ([Aa]). */
export interface EditorFormatGroup {
  readonly id: string
  readonly title: string
  readonly items: readonly EditorQuickActionItem[]
}

/** Hides the on-screen keyboard, including when the focus sits inside the HWP editor frame. */
function hideKeyboard(): void {
  if (typeof document === 'undefined') return
  const active = document.activeElement
  if (active instanceof HTMLIFrameElement) {
    const inner = active.contentDocument?.activeElement
    if (inner && typeof (inner as HTMLElement).blur === 'function') {
      ;(inner as HTMLElement).blur()
    }
  }
  if (active instanceof HTMLElement) active.blur()
}

function isEditableElement(el: unknown): el is HTMLElement {
  if (!el || typeof el !== 'object') return false
  const node = el as {
    tagName?: string
    isContentEditable?: boolean
    getAttribute?: (name: string) => string | null
    blur?: () => void
  }
  if (typeof node.blur !== 'function') return false
  const tag = node.tagName?.toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'INPUT') return true
  if (node.isContentEditable) return true
  const ce = node.getAttribute?.('contenteditable')
  return ce === '' || ce === 'true'
}

/** What the app bar says about saving (design system 5.2). */
export type EditorSaveState = 'saved' | 'dirty' | 'saving' | 'error'

/** Quick action ids that live in the app bar instead of the toolbars. */
const APP_BAR_ACTION_IDS = new Set(['undo', 'redo'])

export interface EditorShellProps {
  readonly docTitle: string
  readonly docFormat: MobileDocFormat
  readonly saveState: EditorSaveState
  readonly mode: DocumentMode
  readonly canEdit: boolean
  readonly aiEnabled: boolean
  readonly noticeBanner?: string | null
  readonly onDismissNotice?: () => void
  readonly quickActions: readonly EditorQuickActionItem[]
  /** Groups for the format panel ([Aa]); a group with id 'insert' moves into the [+] insert sheet. */
  readonly formatGroups?: readonly EditorFormatGroup[]
  /** Explicit items for the [+] insert sheet; defaults to any 'insert' group from `formatGroups`. */
  readonly insertItems?: readonly EditorQuickActionItem[]
  /** Format-specific rows for the More sheet (e.g. Markdown to HWP, Find/Replace). */
  readonly moreItems?: readonly EditorQuickActionItem[]
  /** Inline paired action rows for the More sheet (e.g. Reading view / Page view toggle). */
  readonly morePairs?: readonly EditorMorePair[]
  /** View-mode tools of the document area (page/flow switch, text size, fit width). */
  readonly viewTools?: readonly EditorQuickActionItem[]
  /** Enables the edit-mode keyboard lock toggle; defaults to true for text-centric formats. */
  readonly keyboardLockable?: boolean
  readonly aiPanelContent: ReactNode
  readonly onBack: () => void
  /** [편집]: view -> edit. */
  readonly onEnterEdit: () => void
  /** [완료]: save if needed, then leave edit mode. */
  readonly onDone: () => void
  /** Back in edit mode: leave edit mode without saving (changes stay marked unsaved). */
  readonly onExitEdit: () => void
  readonly onSave: () => void
  /** Absent for read-only kinds without a save function: hides Save As in [⋯]. */
  readonly onSaveAs?: () => void
  readonly onShare: () => void
  /** Absent for formats without PDF sharing (or PDF documents, where Share already sends PDF). */
  readonly onSharePdf?: () => void
  /** Absent when the editor does not expose PDF printing. */
  readonly onPrint?: () => void
  /** Scoped print/PDF labels (EPUB prints the current chapter; Sheets prints the active sheet). */
  readonly printScope?: 'document' | 'chapter' | 'sheet'
  readonly onFitToWidth: () => void
  readonly onOpenBackups: () => void
  readonly children: ReactNode
}

function renderQuickActionIcon(id: string): ReactNode {
  switch (id) {
    case 'undo':
      return <IconUndo size={19} />
    case 'redo':
      return <IconRedo size={19} />
    case 'bold':
      return <IconBold size={18} />
    case 'italic':
      return <IconItalic size={18} />
    case 'underline':
      return <IconUnderline size={18} />
    case 'heading':
      return <IconHeading size={19} />
    case 'list':
    case 'bulletList':
      return <IconList size={19} />
    case 'numberedList':
      return <IconNumberedList size={19} />
    case 'insertTable':
      return <IconTable size={19} />
    case 'memos':
      return <IconMemo size={19} />
    case 'image':
      return <IconImage size={19} />
    case 'fontSmaller':
      return <IconTextSmaller size={19} />
    case 'fontBigger':
      return <IconTextBigger size={19} />
    case 'flowView':
      return <IconFlowView size={19} />
    case 'pageView':
      return <IconPageView size={19} />
    case 'fitWidth':
      return <IconFitWidth size={18} />
    default:
      return null
  }
}

export function EditorShell({
  docTitle,
  docFormat,
  saveState,
  mode,
  canEdit,
  aiEnabled,
  noticeBanner,
  onDismissNotice,
  quickActions,
  formatGroups = [],
  insertItems,
  moreItems = [],
  morePairs = [],
  viewTools = [],
  keyboardLockable,
  aiPanelContent,
  onBack,
  onEnterEdit,
  onDone,
  onExitEdit,
  onSave,
  onSaveAs,
  onShare,
  onSharePdf,
  onPrint,
  printScope = 'document',
  onFitToWidth,
  onOpenBackups,
  children,
}: EditorShellProps) {
  const { t } = useMobileLocale()
  const { isTablet, keyboardInsetPx } = useViewportLayout()
  const stageRef = useRef<HTMLElement | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [formatOpen, setFormatOpen] = useState(false)
  const [insertOpen, setInsertOpen] = useState(false)
  const [keyboardLocked, setKeyboardLocked] = useState(false)
  const keyboardOpen = keyboardInsetPx > 0
  const isHwpFamily = docFormat === 'hwp' || docFormat === 'hwpx'
  const isEdit = mode === 'edit'
  const canLockKeyboard =
    canEdit &&
    (keyboardLockable ??
      (isHwpFamily || docFormat === 'md' || docFormat === 'txt' || docFormat === 'html'))

  // Reset edit-only panels and keyboard lock when returning to view mode.
  useEffect(() => {
    if (!isEdit) {
      setFormatOpen(false)
      setInsertOpen(false)
      setKeyboardLocked(false)
    }
  }, [isEdit])

  // Prevent the soft keyboard from popping up while scrolling/reviewing in edit mode.
  useEffect(() => {
    if (!isEdit || !keyboardLocked) return
    hideKeyboard()
    const stage = stageRef.current
    if (!stage) return

    const savedInputModes = new Map<HTMLElement, string | null>()
    const cleanups: Array<() => void> = []

    const lockRoot = (root: ParentNode, eventTarget: EventTarget) => {
      const editables = root.querySelectorAll<HTMLElement>(
        'textarea, input, [contenteditable=""], [contenteditable="true"]',
      )
      for (const el of editables) {
        if (!savedInputModes.has(el)) {
          savedInputModes.set(el, el.getAttribute('inputmode'))
        }
        el.setAttribute('inputmode', 'none')
      }
      const onFocusIn = (event: Event) => {
        if (isEditableElement(event.target)) {
          event.target.blur()
        }
      }
      eventTarget.addEventListener('focusin', onFocusIn, true)
      cleanups.push(() => eventTarget.removeEventListener('focusin', onFocusIn, true))
    }

    lockRoot(stage, stage)

    const frames = stage.querySelectorAll('iframe')
    for (const frame of frames) {
      const lockFrame = () => {
        try {
          const doc = frame.contentDocument
          if (doc) lockRoot(doc, doc)
        } catch {
          // Cross-origin frame: ignore.
        }
      }
      lockFrame()
      frame.addEventListener('load', lockFrame)
      cleanups.push(() => frame.removeEventListener('load', lockFrame))
    }

    return () => {
      for (const cleanup of cleanups) cleanup()
      for (const [el, prev] of savedInputModes) {
        if (prev === null) el.removeAttribute('inputmode')
        else el.setAttribute('inputmode', prev)
      }
    }
  }, [isEdit, keyboardLocked])

  // Back order (design system 5.11): sheets close first (they register later),
  // then edit mode ends, then the editor screen closes.
  useBackLayer(true, onBack)
  useBackLayer(isEdit, onExitEdit)

  const barActions = quickActions.filter((item) => APP_BAR_ACTION_IDS.has(item.id))
  const toolActions = quickActions.filter((item) => !APP_BAR_ACTION_IDS.has(item.id))

  // Separate insert actions into their own [+] sheet while keeping [Aa] focused on formatting.
  const styleFormatGroups = formatGroups.filter((group) => group.id !== 'insert')
  const effectiveInsertItems =
    insertItems ??
    formatGroups.filter((group) => group.id === 'insert').flatMap((group) => group.items)

  const toggleInsertSheet = () => {
    setInsertOpen((prev) => {
      if (!prev) setFormatOpen(false)
      return !prev
    })
  }

  const toggleFormatSheet = () => {
    setFormatOpen((prev) => {
      if (!prev) setInsertOpen(false)
      return !prev
    })
  }

  // Split [⋯] More sheet into Document tools and File actions.
  const docMoreItems = moreItems.filter((item) => item.section !== 'file')
  const fileMoreItems = moreItems.filter((item) => item.section === 'file')
  const docMorePairs = morePairs.filter((pair) => pair.section !== 'file')
  const fileMorePairs = morePairs.filter((pair) => pair.section === 'file')
  const hasDocSection = docMorePairs.length > 0 || docMoreItems.length > 0 || isHwpFamily

  const saveLabel =
    saveState === 'saving'
      ? t('saveStateSaving')
      : saveState === 'error'
        ? t('saveStateFailed')
        : saveState === 'dirty'
          ? t('saveStateDirty')
          : t('saveStateSaved')
  const saveActionable = saveState === 'dirty' || saveState === 'error'

  const renderMorePair = (pair: EditorMorePair) => (
    <div key={pair.id} className="mobile-menu-pair-row" data-testid={`more-pair-${pair.id}`}>
      <span className="mobile-menu-pair-label">{pair.label}</span>
      <div className="mobile-menu-pair-actions">
        {pair.actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className="mobile-menu-pair-btn"
            aria-pressed={action.active}
            data-testid={`more-pair-${pair.id}-${action.id}`}
            onClick={() => {
              setMoreOpen(false)
              action.onPress()
            }}
          >
            {action.icon ?? renderQuickActionIcon(action.id)}
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div
      className={isTablet ? 'mobile-shell mobile-shell-tablet' : 'mobile-shell mobile-shell-phone'}
      data-layout={isTablet ? 'tablet' : 'phone'}
      data-mode={mode}
    >
      <header className="mobile-editor-header" data-testid="editor-header">
        <button
          type="button"
          className="mobile-icon-btn"
          onClick={onBack}
          aria-label={t('back')}
          title={t('back')}
          data-testid="editor-back-btn"
        >
          <IconBack size={22} />
        </button>

        <div className="mobile-header-title-wrap">
          {!isEdit && <DocTypeIcon format={docFormat} size={20} />}
          <div className="mobile-header-title-stack">
            <span className="mobile-header-title">{docTitle}</span>
            {(isEdit || saveActionable || saveState === 'saving') && (
              <button
                type="button"
                className="mobile-save-state"
                data-state={saveState}
                onClick={saveActionable ? onSave : undefined}
                disabled={!saveActionable}
                aria-live="polite"
                data-testid="editor-save-btn"
              >
                <span className="mobile-save-dot" aria-hidden="true" />
                <span className="mobile-save-text">{saveLabel}</span>
              </button>
            )}
          </div>
        </div>

        <div className="mobile-header-actions">
          {isEdit &&
            barActions.map((item) => (
              <button
                key={item.id}
                type="button"
                className="mobile-icon-btn"
                onClick={item.onPress}
                aria-label={item.label}
                title={item.label}
              >
                {item.icon ?? renderQuickActionIcon(item.id)}
              </button>
            ))}
          {isTablet &&
            !isEdit &&
            viewTools.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.showLabel ? 'mobile-header-view-pill' : 'mobile-icon-btn'}
                onClick={item.onPress}
                aria-label={item.label}
                title={item.label}
                data-testid={`view-tool-${item.id}`}
              >
                {item.icon ?? renderQuickActionIcon(item.id)}
                {item.showLabel && <span>{item.label}</span>}
              </button>
            ))}
          {!isEdit && (
            <button
              type="button"
              className="mobile-icon-btn"
              onClick={onShare}
              aria-label={t('share')}
              title={t('share')}
              data-testid="editor-share-btn"
            >
              <IconShare size={20} />
            </button>
          )}
          {isTablet && aiEnabled && (
            <button
              type="button"
              className="mobile-icon-btn mobile-btn-ai-icon"
              onClick={() => setAiOpen((prev) => !prev)}
              aria-label={t('aiTitle')}
              aria-pressed={aiOpen}
              title={t('aiTitle')}
              data-testid="tablet-ai-toggle"
            >
              <AiMark size={18} />
            </button>
          )}
          {(isEdit || canEdit) && (
            <button
              type="button"
              className="mobile-text-btn"
              onClick={isEdit ? onDone : onEnterEdit}
              data-testid="editor-mode-toggle"
            >
              {isEdit ? <IconCheck size={16} /> : <IconEdit size={16} />}
              <span>{isEdit ? t('switchToView') : t('switchToEdit')}</span>
            </button>
          )}
          <button
            type="button"
            className="mobile-icon-btn"
            onClick={() => setMoreOpen(true)}
            aria-label={t('more')}
            title={t('more')}
            data-testid="editor-more-btn"
          >
            <IconMore size={20} />
          </button>
        </div>
      </header>

      {isTablet &&
        isEdit &&
        (toolActions.length > 0 ||
          effectiveInsertItems.length > 0 ||
          styleFormatGroups.length > 0) && (
          <div className="mobile-tablet-toolbar" role="toolbar" data-testid="tablet-toolbar">
            {toolActions.map((item) => {
              const icon = item.icon ?? renderQuickActionIcon(item.id)
              return (
                <button
                  key={item.id}
                  type="button"
                  className="mobile-toolbar-btn"
                  onClick={item.onPress}
                  aria-label={item.label}
                  title={item.label}
                >
                  {icon}
                  <span>{item.label}</span>
                </button>
              )
            })}
            {effectiveInsertItems.length > 0 && (
              <button
                type="button"
                className="mobile-toolbar-btn"
                onPointerDown={(e) => e.preventDefault()}
                onClick={toggleInsertSheet}
                aria-pressed={insertOpen}
                data-testid="tablet-insert-panel-btn"
              >
                <IconPlus size={20} />
                <span>{t('insertPanel')}</span>
              </button>
            )}
            {styleFormatGroups.length > 0 && (
              <button
                type="button"
                className="mobile-toolbar-btn"
                onPointerDown={(e) => e.preventDefault()}
                onClick={toggleFormatSheet}
                aria-pressed={formatOpen}
                data-testid="tablet-format-panel-btn"
              >
                <IconTextFormat size={18} />
                <span>{t('formatPanel')}</span>
              </button>
            )}
          </div>
        )}

      {noticeBanner && (
        <div className="mobile-editor-banner" role="status" data-testid="editor-notice-banner">
          <span className="mobile-editor-banner-text">{noticeBanner}</span>
          {onDismissNotice && (
            <button
              type="button"
              className="mobile-banner-close"
              onClick={onDismissNotice}
              aria-label={t('cancel')}
            >
              <IconClose size={16} />
            </button>
          )}
        </div>
      )}

      <div className="mobile-workspace-row">
        <section
          ref={stageRef}
          className="mobile-editor-stage"
          data-keyboard-locked={isEdit && keyboardLocked ? 'true' : undefined}
        >
          {children}
        </section>

        {isTablet && aiEnabled && aiOpen && (
          <aside className="mobile-tablet-ai-dock" data-testid="tablet-ai-dock">
            <header className="mobile-sheet-header">
              <div className="mobile-sheet-title-wrap">
                <AiMark size={18} />
                <h2 className="mobile-sheet-title">{t('aiTitle')}</h2>
              </div>
              <button
                type="button"
                className="mobile-icon-btn"
                onClick={() => setAiOpen(false)}
                aria-label={t('cancel')}
              >
                <IconClose size={20} />
              </button>
            </header>
            {aiPanelContent}
          </aside>
        )}
      </div>

      {!isTablet && isEdit && (
        <nav
          className="mobile-quick-toolbar"
          style={keyboardInsetPx > 0 ? { marginBottom: `${keyboardInsetPx}px` } : undefined}
          aria-label="Quick formatting"
          data-testid="phone-quick-toolbar"
        >
          <div className="mobile-quick-scroll" role="toolbar">
            {toolActions.map((item) => {
              const icon = item.icon ?? renderQuickActionIcon(item.id)
              return (
                <button
                  key={item.id}
                  type="button"
                  className="mobile-quick-icon-btn"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={item.onPress}
                  aria-label={item.label}
                  title={item.label}
                >
                  {icon ?? <span>{item.label}</span>}
                </button>
              )
            })}
          </div>
          {effectiveInsertItems.length > 0 && (
            <button
              type="button"
              className="mobile-quick-icon-btn mobile-quick-fixed-btn"
              onPointerDown={(e) => e.preventDefault()}
              onClick={toggleInsertSheet}
              aria-label={t('insertPanel')}
              aria-pressed={insertOpen}
              title={t('insertPanel')}
              data-testid="insert-panel-btn"
            >
              <IconPlus size={20} />
            </button>
          )}
          {styleFormatGroups.length > 0 && (
            <button
              type="button"
              className="mobile-quick-icon-btn mobile-quick-fixed-btn"
              onPointerDown={(e) => e.preventDefault()}
              onClick={toggleFormatSheet}
              aria-label={t('formatPanel')}
              aria-pressed={formatOpen}
              title={t('formatPanel')}
              data-testid="format-panel-btn"
            >
              <IconTextFormat size={20} />
            </button>
          )}
          {canLockKeyboard && (
            <button
              type="button"
              className="mobile-quick-icon-btn mobile-quick-fixed-btn"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setKeyboardLocked((prev) => !prev)}
              aria-label={keyboardLocked ? t('keyboardUnlock') : t('keyboardLock')}
              aria-pressed={keyboardLocked}
              title={keyboardLocked ? t('keyboardUnlock') : t('keyboardLock')}
              data-testid="keyboard-lock-btn"
            >
              {keyboardLocked ? <IconLock size={20} /> : <IconUnlock size={20} />}
            </button>
          )}
          {keyboardOpen && !keyboardLocked && (
            <button
              type="button"
              className="mobile-quick-icon-btn mobile-quick-fixed-btn"
              onPointerDown={(e) => e.preventDefault()}
              onClick={hideKeyboard}
              aria-label={t('hideKeyboard')}
              title={t('hideKeyboard')}
              data-testid="hide-keyboard-btn"
            >
              <IconKeyboardHide size={20} />
            </button>
          )}
          {aiEnabled && (
            <button
              type="button"
              className="mobile-quick-icon-btn mobile-btn-ai-icon mobile-quick-ai-btn"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setAiOpen(true)}
              aria-label={t('aiTitle')}
              title={t('aiTitle')}
              data-testid="phone-ai-open-btn"
            >
              <AiMark size={18} />
            </button>
          )}
        </nav>
      )}

      {!isTablet && !isEdit && (viewTools.length > 0 || aiEnabled) && (
        <div className="mobile-view-fab-bar">
          {viewTools.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.showLabel ? 'mobile-fab-pill' : 'mobile-fab-mini'}
              onClick={item.onPress}
              aria-label={item.label}
              title={item.label}
              data-testid={`view-tool-${item.id}`}
            >
              {item.icon ?? renderQuickActionIcon(item.id)}
              {item.showLabel && <span>{item.label}</span>}
            </button>
          ))}
          {aiEnabled && (
            <button
              type="button"
              className="mobile-fab-btn mobile-btn-ai"
              onClick={() => setAiOpen(true)}
              data-testid="phone-view-ai-btn"
            >
              <AiMark size={17} />
              <span>{t('aiTitle')}</span>
            </button>
          )}
        </div>
      )}

      {!isTablet && aiEnabled && (
        <Sheet
          open={aiOpen}
          title={t('aiTitle')}
          closeLabel={t('cancel')}
          onClose={() => setAiOpen(false)}
          testId="editor-ai-sheet"
        >
          {aiPanelContent}
        </Sheet>
      )}

      <Sheet
        open={isEdit && insertOpen && effectiveInsertItems.length > 0}
        title={t('insertPanel')}
        closeLabel={t('cancel')}
        onClose={() => setInsertOpen(false)}
        modal={false}
        testId="editor-insert-sheet"
      >
        <div className="mobile-format-panel">
          <div className="mobile-format-grid">
            {effectiveInsertItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="mobile-format-btn"
                data-testid={`editor-insert-${item.id}`}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => {
                  setInsertOpen(false)
                  item.onPress()
                }}
              >
                {item.icon ?? renderQuickActionIcon(item.id)}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </Sheet>

      <Sheet
        open={isEdit && formatOpen && styleFormatGroups.length > 0}
        title={t('formatPanel')}
        closeLabel={t('cancel')}
        onClose={() => setFormatOpen(false)}
        modal={false}
        testId="editor-format-sheet"
      >
        <div className="mobile-format-panel">
          {styleFormatGroups.map((group) => (
            <section key={group.id} className="mobile-format-group" aria-label={group.title}>
              <h3 className="mobile-format-group-title">{group.title}</h3>
              <div className="mobile-format-grid">
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="mobile-format-btn"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={item.onPress}
                  >
                    {item.icon ?? renderQuickActionIcon(item.id)}
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </Sheet>

      <Sheet
        open={moreOpen}
        title={t('more')}
        closeLabel={t('cancel')}
        onClose={() => setMoreOpen(false)}
        testId="editor-more-sheet"
      >
        <div className="mobile-menu-stack">
          {hasDocSection && (
            <section
              className="mobile-menu-section"
              aria-label={t('moreSectionDocument')}
              data-testid="more-section-document"
            >
              <h3 className="mobile-menu-section-title">{t('moreSectionDocument')}</h3>
              {docMorePairs.map(renderMorePair)}
              {docMoreItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="mobile-menu-row-btn"
                  data-testid={`editor-more-${item.id}`}
                  onClick={() => {
                    setMoreOpen(false)
                    item.onPress()
                  }}
                >
                  {item.icon ?? renderQuickActionIcon(item.id)}
                  <span>{item.label}</span>
                </button>
              ))}
              {isHwpFamily && (
                <button
                  type="button"
                  className="mobile-menu-row-btn"
                  data-testid="editor-fit-width-btn"
                  onClick={() => {
                    setMoreOpen(false)
                    onFitToWidth()
                  }}
                >
                  <IconFitWidth size={19} />
                  <span>{t('fitToWidth')}</span>
                </button>
              )}
            </section>
          )}
          {hasDocSection && <hr className="mobile-menu-divider" />}
          <section
            className="mobile-menu-section"
            aria-label={t('moreSectionFile')}
            data-testid="more-section-file"
          >
            <h3 className="mobile-menu-section-title">{t('moreSectionFile')}</h3>
            {onSaveAs && (
              <button
                type="button"
                className="mobile-menu-row-btn"
                data-testid="editor-save-as-btn"
                onClick={() => {
                  setMoreOpen(false)
                  onSaveAs()
                }}
              >
                <IconSave size={19} />
                <span>{t('saveAs')}</span>
              </button>
            )}
            <button
              type="button"
              className="mobile-menu-row-btn"
              data-testid="editor-sheet-share-btn"
              onClick={() => {
                setMoreOpen(false)
                onShare()
              }}
            >
              <IconShare size={19} />
              <span>{t('share')}</span>
            </button>
            {onSharePdf && (
              <button
                type="button"
                className="mobile-menu-row-btn"
                data-testid="editor-share-pdf-btn"
                onClick={() => {
                  setMoreOpen(false)
                  onSharePdf()
                }}
              >
                <HomeSharePdfIcon size={19} />
                <span>
                  {t(
                    printScope === 'chapter'
                      ? 'homeShareChapterPdf'
                      : printScope === 'sheet'
                        ? 'homeShareSheetPdf'
                        : 'homeShareAsPdf',
                  )}
                </span>
              </button>
            )}
            {onPrint && (
              <button
                type="button"
                className="mobile-menu-row-btn"
                data-testid="editor-print-btn"
                onClick={() => {
                  setMoreOpen(false)
                  onPrint()
                }}
              >
                <HomePrintIcon size={19} />
                <span>
                  {t(
                    printScope === 'chapter'
                      ? 'homePrintChapter'
                      : printScope === 'sheet'
                        ? 'homePrintSheet'
                        : 'homePrint',
                  )}
                </span>
              </button>
            )}
            {fileMorePairs.map(renderMorePair)}
            {fileMoreItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="mobile-menu-row-btn"
                data-testid={`editor-more-${item.id}`}
                onClick={() => {
                  setMoreOpen(false)
                  item.onPress()
                }}
              >
                {item.icon ?? renderQuickActionIcon(item.id)}
                <span>{item.label}</span>
              </button>
            ))}
            {isHwpFamily && (
              <button
                type="button"
                className="mobile-menu-row-btn"
                data-testid="editor-backups-btn"
                onClick={() => {
                  setMoreOpen(false)
                  onOpenBackups()
                }}
              >
                <IconHistory size={19} />
                <span>{t('settingsBackupsSection')}</span>
              </button>
            )}
          </section>
        </div>
      </Sheet>
    </div>
  )
}
