/**
 * The result sheet (spec 5.3, result sheet): the new files, kept in memory,
 * with [Open][Share][Save elsewhere] for each, and for several files one ZIP to
 * share or save. Closing with results neither saved nor shared asks first;
 * the flow owns that question.
 */
import { IconFolderOpen, IconSave, IconShare } from '../../components/MobileIcons'
import { Sheet } from '../../components/Sheet'
import { useMobileLocale } from '../../i18n'
import type { ToolResultFile } from '../engine/types'
import { formatBytes } from './format'

export interface ResultSheetProps {
  readonly files: readonly ToolResultFile[]
  /** compress: the original's size */
  readonly sizeBefore?: number
  /** split by size: 1-based pages larger than the size asked for */
  readonly oversizedPages?: readonly number[]
  /** a share, save or ZIP is on its way */
  readonly busy: boolean
  canOpen(file: ToolResultFile): boolean
  onOpen(index: number): void
  onShare(index: number): void
  onSave(index: number): void
  onZipShare(): void
  onZipSave(): void
  onClose(): void
}

export function ResultSheet({
  files,
  sizeBefore,
  oversizedPages,
  busy,
  canOpen,
  onOpen,
  onShare,
  onSave,
  onZipShare,
  onZipSave,
  onClose,
}: ResultSheetProps) {
  const { t, lang } = useMobileLocale()
  const single = files.length === 1
  const sizeText = (file: ToolResultFile) =>
    sizeBefore !== undefined
      ? t('pdfToolsSizeChange', {
          before: formatBytes(sizeBefore, lang),
          after: formatBytes(file.bytes.length, lang),
        })
      : formatBytes(file.bytes.length, lang)

  return (
    <Sheet
      open
      title={t('pdfToolsResultTitle')}
      closeLabel={t('pdfToolsClose')}
      onClose={onClose}
      initialDetent={single ? 'medium' : 'large'}
      testId="pdf-tools-result-sheet"
    >
      <div className="pdf-tools-result" aria-busy={busy ? 'true' : undefined}>
        <p className="pdf-tools-result-done" role="status">
          {single
            ? t('pdfToolsDoneOne', { name: files[0]!.name })
            : t('pdfToolsDoneMany', { n: files.length })}
        </p>
        {oversizedPages && oversizedPages.length > 0 && (
          <p className="mobile-muted">
            {t('pdfToolsSplitOversizedWarn', { pages: oversizedPages.join(', ') })}
          </p>
        )}
        {single ? (
          <>
            <p className="pdf-tools-result-size" data-testid="pdf-tools-result-size">
              {sizeText(files[0]!)}
            </p>
            <div className="pdf-tools-step-actions">
              {canOpen(files[0]!) && (
                <button
                  type="button"
                  className="mobile-touch-btn mobile-btn-secondary"
                  disabled={busy}
                  onClick={() => onOpen(0)}
                >
                  {t('pdfToolsOpen')}
                </button>
              )}
              <button
                type="button"
                className="mobile-touch-btn mobile-btn-secondary"
                disabled={busy}
                onClick={() => onShare(0)}
              >
                {t('pdfToolsShare')}
              </button>
              <button
                type="button"
                className="mobile-touch-btn mobile-btn-primary"
                disabled={busy}
                onClick={() => onSave(0)}
              >
                {t('pdfToolsSaveCopy')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="pdf-tools-step-actions">
              <button
                type="button"
                className="mobile-touch-btn mobile-btn-secondary"
                disabled={busy}
                onClick={onZipShare}
              >
                {t('pdfToolsZipShareAll')}
              </button>
              <button
                type="button"
                className="mobile-touch-btn mobile-btn-primary"
                disabled={busy}
                onClick={onZipSave}
              >
                {t('pdfToolsZipSaveAll')}
              </button>
            </div>
            <ul className="pdf-tools-file-list">
              {files.map((file, index) => {
                const nameId = `pdf-tools-result-${index}`
                return (
                  <li
                    key={`${index}-${file.name}`}
                    className="pdf-tools-file-row"
                    data-testid="pdf-tools-result-row"
                  >
                    <div className="pdf-tools-file-text">
                      <span id={nameId} className="pdf-tools-file-name">
                        {file.name}
                      </span>
                      <span className="pdf-tools-file-meta">{sizeText(file)}</span>
                    </div>
                    <div className="pdf-tools-file-actions">
                      {canOpen(file) && (
                        <button
                          type="button"
                          className="mobile-icon-btn"
                          aria-label={t('pdfToolsOpen')}
                          title={t('pdfToolsOpen')}
                          aria-describedby={nameId}
                          disabled={busy}
                          onClick={() => onOpen(index)}
                        >
                          <IconFolderOpen size={20} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="mobile-icon-btn"
                        aria-label={t('pdfToolsShare')}
                        title={t('pdfToolsShare')}
                        aria-describedby={nameId}
                        disabled={busy}
                        onClick={() => onShare(index)}
                      >
                        <IconShare size={20} />
                      </button>
                      <button
                        type="button"
                        className="mobile-icon-btn"
                        aria-label={t('pdfToolsSaveCopy')}
                        title={t('pdfToolsSaveCopy')}
                        aria-describedby={nameId}
                        disabled={busy}
                        onClick={() => onSave(index)}
                      >
                        <IconSave size={20} />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </Sheet>
  )
}
