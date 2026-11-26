/**
 * The PDF tools list (spec 5.2): the two intro lines, the four groups of
 * tool cards and the "in the PDF editor" card. Drawn inside the home [Tools] tab
 * and as the first step of the full-screen tools layer. No AI here.
 */
import { isMobileCommandError } from '@genoffice/mobile-bridge/transport'
import { pdfToolsIcons } from '../components/icons/pdfTools'
import type { HomeHost } from '../home/homeHost'
import { useMobileLocale } from '../i18n'
import { TOOL_GROUPS, toolDescKey, toolNameKey, type MobilePdfToolId } from './catalog'
import { useEditorOpens } from './env'
import './pdfTools.css'

export interface ToolsListProps {
  readonly host: HomeHost
  onPickTool(tool: MobilePdfToolId): void
  /** Called once the edit card opened a PDF in the editor (the tools layer closes) */
  onLeave?(): void
}

export function ToolsList({ host, onPickTool, onLeave }: ToolsListProps) {
  const { t } = useMobileLocale()
  const editorOpens = useEditorOpens()
  const EditIcon = pdfToolsIcons.edit

  const openInEditor = async () => {
    try {
      const session = await host.client.pickOpenFile(['pdf'])
      await host.openSession(session)
      onLeave?.()
    } catch (err) {
      if (isMobileCommandError(err) && err.code === 'USER_CANCELLED') return
      host.showToast({ message: t('pdfToolsErrFailed'), tone: 'error' })
    }
  }

  return (
    <div className="pdf-tools-list" data-testid="pdf-tools-list">
      <div className="pdf-tools-intro">
        <p className="mobile-muted">{t('pdfToolsIntro')}</p>
        <p className="mobile-muted">{t('pdfToolsDeviceNote')}</p>
      </div>
      {TOOL_GROUPS.map((group) => (
        <section key={group.titleKey} className="pdf-tools-group">
          <h2 className="mobile-section-title">{t(group.titleKey)}</h2>
          <ul className="pdf-tools-cards">
            {group.tools.map((tool) => {
              const Icon = pdfToolsIcons[tool]
              return (
                <li key={tool}>
                  <button
                    type="button"
                    className="pdf-tools-card"
                    data-tool={tool}
                    onClick={() => onPickTool(tool)}
                  >
                    <span className="pdf-tools-card-icon">
                      <Icon size={24} />
                    </span>
                    <span className="pdf-tools-card-text">
                      <span className="pdf-tools-card-name">{t(toolNameKey(tool))}</span>
                      <span className="pdf-tools-card-desc">{t(toolDescKey(tool))}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      {editorOpens('pdf') && (
        <section className="pdf-tools-group">
          <h2 className="mobile-section-title">{t('pdfToolsGroupEditor')}</h2>
          <ul className="pdf-tools-cards">
            <li>
              <button
                type="button"
                className="pdf-tools-card"
                data-tool="edit"
                onClick={() => void openInEditor()}
              >
                <span className="pdf-tools-card-icon">
                  <EditIcon size={24} />
                </span>
                <span className="pdf-tools-card-text">
                  <span className="pdf-tools-card-name">{t('pdfToolsEditCard')}</span>
                  <span className="pdf-tools-card-desc">{t('pdfToolsEditCardDesc')}</span>
                </span>
              </button>
            </li>
          </ul>
        </section>
      )}
    </div>
  )
}
