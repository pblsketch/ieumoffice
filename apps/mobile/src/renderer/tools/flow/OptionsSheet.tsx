/**
 * The options sheet (spec 5.3, options sheet): the tool's form (tools/options,
 * filled by PTL-T9), the error of the options as they are, why the last run
 * ended without a result, and [Start] ([Find] for blank pages).
 */
import type { ReactNode } from 'react'
import { Sheet } from '../../components/Sheet'
import { useMobileLocale, type MobileStringKey } from '../../i18n'
import type { MobilePdfToolId } from '../catalog'
import type { ToolOptionsError } from '../options'
import { optionsErrorKey } from './format'

/** Errors the option forms show under their own field; the sheet then only announces them */
const FIELD_ERRORS: ReadonlySet<string> = new Set([
  'range',
  'invalid-size',
  'no-kinds',
  'password-empty',
  'password-long',
  'password-same',
  'password-mismatch',
])

export interface OptionsSheetProps {
  readonly title: string
  readonly tool: MobilePdfToolId
  /** blank pages: the sheet only finds candidates */
  readonly finding: boolean
  /** why the last run ended without a result */
  readonly notice: MobileStringKey | null
  readonly error: ToolOptionsError | null
  onStart(): void
  onClose(): void
  readonly children?: ReactNode
}

export function OptionsSheet({
  title,
  tool,
  finding,
  notice,
  error,
  onStart,
  onClose,
  children,
}: OptionsSheetProps) {
  const { t } = useMobileLocale()
  return (
    <Sheet
      open
      title={title}
      closeLabel={t('pdfToolsClose')}
      onClose={onClose}
      testId="pdf-tools-options-sheet"
    >
      <div className="pdf-tools-options" data-tool={tool}>
        {finding && <p className="mobile-muted">{t('pdfToolsNoteBlank')}</p>}
        {children}
        {error && (
          <p
            className={FIELD_ERRORS.has(error) ? 'mobile-sr-only' : 'pdf-tools-error'}
            role="alert"
            data-testid="pdf-tools-options-error"
          >
            {t(optionsErrorKey(error))}
          </p>
        )}
        {notice && (
          <p className="pdf-tools-notice" role="alert" data-testid="pdf-tools-notice">
            {t(notice)}
          </p>
        )}
        <div className="pdf-tools-step-actions">
          <button type="button" className="mobile-touch-btn mobile-btn-primary" onClick={onStart}>
            {t(finding ? 'pdfToolsFindBlank' : 'pdfToolsStart')}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
