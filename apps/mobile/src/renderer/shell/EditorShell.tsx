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
  IconHeading,
  IconHistory,
  IconImage,
  IconItalic,
  IconList,
  IconMore,
  IconRedo,
  IconSave,
  IconShare,
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

      {!isTablet && !isEdit && (isHwpFamily || aiEnabled) && (
        <div className="mobile-view-fab-bar">
          {isHwpFamily && (
            <button
              type="button"
              className="mobile-fab-mini"
              onClick={onFitToWidth}
              aria-label={t('fitToWidth')}
              title={t('fitToWidth')}
            >
              <IconFitWidth size={18} />
            </button>
          )}
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
