import { useState, type ReactNode } from 'react'
import { AiMark } from '@genoffice/ui'
import type { DocumentMode } from '@genoffice/mobile-bridge/view-edit-gate'
import type { MobileDocFormat } from '@genoffice/mobile-bridge/transport'
import { useMobileLocale } from '../i18n'
import { BottomSheet } from '../components/BottomSheet'
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
import { useViewportLayout } from './useViewportLayout'

export interface EditorQuickActionItem {
  readonly id: string
  readonly label: string
  readonly onPress: () => void
}

export interface EditorShellProps {
  readonly docTitle: string
  readonly docFormat: MobileDocFormat
  readonly dirty: boolean
  readonly mode: DocumentMode
  readonly canEdit: boolean
  readonly aiEnabled: boolean
  readonly noticeBanner?: string | null
  readonly toastMessage?: string | null
  readonly onDismissNotice?: () => void
  readonly quickActions: readonly EditorQuickActionItem[]
  readonly aiPanelContent: ReactNode
  readonly onBack: () => void
  readonly onToggleMode: () => void
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
  dirty,
  mode,
  canEdit,
  aiEnabled,
  noticeBanner,
  toastMessage,
  onDismissNotice,
  quickActions,
  aiPanelContent,
  onBack,
  onToggleMode,
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
          <DocTypeIcon format={docFormat} size={20} />
          <span className="mobile-header-title">{docTitle}</span>
          {dirty && <span className="mobile-dirty-dot" aria-label="unsaved" />}
        </div>

        <div className="mobile-header-actions">
          {canEdit && (
            <button
              type="button"
              className="mobile-pill-btn mobile-btn-secondary"
              onClick={onToggleMode}
              data-testid="editor-mode-toggle"
            >
              {mode === 'view' ? <IconEdit size={14} /> : <IconCheck size={14} />}
              <span>{mode === 'view' ? t('switchToEdit') : t('switchToView')}</span>
            </button>
          )}
          <button
            type="button"
            className={
              dirty ? 'mobile-pill-btn mobile-btn-primary' : 'mobile-pill-btn mobile-btn-secondary'
            }
            onClick={onSave}
            aria-label={t('save')}
            data-testid="editor-save-btn"
          >
            <IconSave size={14} />
            <span>{t('save')}</span>
          </button>
          {isTablet && aiEnabled && (
            <button
              type="button"
              className="mobile-pill-btn mobile-btn-ai"
              onClick={() => setAiOpen((prev) => !prev)}
              data-testid="tablet-ai-toggle"
            >
              <AiMark size={15} />
              <span>{t('aiTitle')}</span>
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

      {isTablet && mode === 'edit' && quickActions.length > 0 && (
        <div className="mobile-tablet-toolbar" role="toolbar" data-testid="tablet-toolbar">
          {quickActions.map((item) => {
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
        <section className="mobile-editor-stage">
          {children}
          {toastMessage && (
            <div className="mobile-toast" role="status" aria-live="polite">
              <IconCheck size={15} />
              <span>{toastMessage}</span>
            </div>
          )}
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

      {!isTablet && mode === 'edit' && (
        <nav
          className="mobile-quick-toolbar"
          style={keyboardInsetPx > 0 ? { marginBottom: `${keyboardInsetPx}px` } : undefined}
          aria-label="Quick formatting"
          data-testid="phone-quick-toolbar"
        >
          <div className="mobile-quick-scroll">
            {quickActions.map((item) => {
              const icon = renderQuickActionIcon(item.id)
              return (
                <button
                  key={item.id}
                  type="button"
                  className="mobile-quick-icon-btn"
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
              className="mobile-pill-btn mobile-btn-ai mobile-quick-ai-btn"
              onClick={() => setAiOpen(true)}
              aria-label={t('aiTitle')}
              data-testid="phone-ai-open-btn"
            >
              <AiMark size={15} />
              <span>AI</span>
            </button>
          )}
        </nav>
      )}

      {!isTablet && mode === 'view' && (
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
        <BottomSheet
          open={aiOpen}
          title={t('aiTitle')}
          closeLabel={t('cancel')}
          onClose={() => setAiOpen(false)}
        >
          {aiPanelContent}
        </BottomSheet>
      )}

      <BottomSheet
        open={moreOpen}
        title={t('more')}
        closeLabel={t('cancel')}
        onClose={() => setMoreOpen(false)}
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
      </BottomSheet>
    </div>
  )
}
