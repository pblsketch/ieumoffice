import { useState, type ReactNode } from 'react'
import { AiMark } from '@genoffice/ui'
import type { DocumentMode } from '@genoffice/mobile-bridge/view-edit-gate'
import type { MobileDocFormat } from '@genoffice/mobile-bridge/transport'
import { useMobileLocale } from '../i18n'
import { Sheet } from '../components/Sheet'
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
  IconMore,
  IconPageView,
  IconRedo,
  IconSave,
  IconShare,
  IconTextBigger,
  IconTextFormat,
  IconTextSmaller,
  IconUnderline,
  IconUndo,
} from '../components/MobileIcons'
import { useBackLayer } from './backStack'
import { useViewportLayout } from './useViewportLayout'

export interface EditorQuickActionItem {
  readonly id: string
  readonly label: string
  readonly onPress: () => void
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
    if (inner instanceof HTMLElement) inner.blur()
  }
  if (active instanceof HTMLElement) active.blur()
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
  /** Groups for the format panel ([Aa]); none hides the button. */
  readonly formatGroups?: readonly EditorFormatGroup[]
  /** View-mode tools of the document area (page/flow switch, text size, fit width). */
  readonly viewTools?: readonly EditorQuickActionItem[]
  readonly aiPanelContent: ReactNode
  readonly onBack: () => void
  /** [편집]: view -> edit. */
  readonly onEnterEdit: () => void
  /** [완료]: save if needed, then leave edit mode. */
  readonly onDone: () => void
  /** Back in edit mode: leave edit mode without saving (changes stay marked unsaved). */
  readonly onExitEdit: () => void
  readonly onSave: () => void
  readonly onSaveAs: () => void
  readonly onShare: () => void
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
      return <IconList size={19} />
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
  viewTools = [],
  aiPanelContent,
  onBack,
  onEnterEdit,
  onDone,
  onExitEdit,
  onSave,
  onSaveAs,
  onShare,
  onFitToWidth,
  onOpenBackups,
  children,
}: EditorShellProps) {
  const { t } = useMobileLocale()
  const { isTablet, keyboardInsetPx } = useViewportLayout()
  const [aiOpen, setAiOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [formatOpen, setFormatOpen] = useState(false)
  const keyboardOpen = keyboardInsetPx > 0
  const isHwpFamily = docFormat === 'hwp' || docFormat === 'hwpx'
  const isEdit = mode === 'edit'

  // Back order (design system 5.11): sheets close first (they register later),
  // then edit mode ends, then the editor screen closes.
  useBackLayer(true, onBack)
  useBackLayer(isEdit, onExitEdit)

  const barActions = quickActions.filter((item) => APP_BAR_ACTION_IDS.has(item.id))
  const toolActions = quickActions.filter((item) => !APP_BAR_ACTION_IDS.has(item.id))

  const saveLabel =
    saveState === 'saving'
      ? t('saveStateSaving')
      : saveState === 'error'
        ? t('saveStateFailed')
        : saveState === 'dirty'
          ? t('saveStateDirty')
          : t('saveStateSaved')
  const saveActionable = saveState === 'dirty' || saveState === 'error'

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
                {renderQuickActionIcon(item.id)}
              </button>
            ))}
          {isTablet &&
            !isEdit &&
            viewTools.map((item) => (
              <button
                key={item.id}
                type="button"
                className="mobile-icon-btn"
                onClick={item.onPress}
                aria-label={item.label}
                title={item.label}
              >
                {renderQuickActionIcon(item.id)}
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

      {isTablet && isEdit && toolActions.length > 0 && (
        <div className="mobile-tablet-toolbar" role="toolbar" data-testid="tablet-toolbar">
          {toolActions.map((item) => {
            const icon = renderQuickActionIcon(item.id)
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
          {formatGroups.length > 0 && (
            <button
              type="button"
              className="mobile-toolbar-btn"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setFormatOpen((prev) => !prev)}
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
        <section className="mobile-editor-stage">{children}</section>

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
              const icon = renderQuickActionIcon(item.id)
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
          {formatGroups.length > 0 && (
            <button
              type="button"
              className="mobile-quick-icon-btn mobile-quick-fixed-btn"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setFormatOpen((prev) => !prev)}
              aria-label={t('formatPanel')}
              aria-pressed={formatOpen}
              title={t('formatPanel')}
              data-testid="format-panel-btn"
            >
              <IconTextFormat size={20} />
            </button>
          )}
          {keyboardOpen && (
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
              className="mobile-fab-mini"
              onClick={item.onPress}
              aria-label={item.label}
              title={item.label}
              data-testid={`view-tool-${item.id}`}
            >
              {renderQuickActionIcon(item.id)}
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
        open={isEdit && formatOpen && formatGroups.length > 0}
        title={t('formatPanel')}
        closeLabel={t('cancel')}
        onClose={() => setFormatOpen(false)}
        modal={false}
        testId="editor-format-sheet"
      >
        <div className="mobile-format-panel">
          {formatGroups.map((group) => (
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
                    {renderQuickActionIcon(item.id)}
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
          <button
            type="button"
            className="mobile-menu-row-btn"
            onClick={() => {
              setMoreOpen(false)
              onSaveAs()
            }}
          >
            <IconSave size={19} />
            <span>{t('saveAs')}</span>
          </button>
          <button
            type="button"
            className="mobile-menu-row-btn"
            onClick={() => {
              setMoreOpen(false)
              onShare()
            }}
          >
            <IconShare size={19} />
            <span>{t('share')}</span>
          </button>
          {isHwpFamily && (
            <button
              type="button"
              className="mobile-menu-row-btn"
              onClick={() => {
                setMoreOpen(false)
                onFitToWidth()
              }}
            >
              <IconFitWidth size={19} />
              <span>{t('fitToWidth')}</span>
            </button>
          )}
          {isHwpFamily && (
            <button
              type="button"
              className="mobile-menu-row-btn"
              onClick={() => {
                setMoreOpen(false)
                onOpenBackups()
              }}
            >
              <IconHistory size={19} />
              <span>{t('settingsBackupsSection')}</span>
            </button>
          )}
        </div>
      </Sheet>
    </div>
  )
}
