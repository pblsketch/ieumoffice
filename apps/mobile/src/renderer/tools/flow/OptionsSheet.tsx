/**
 * The options sheet (spec 5.3, options sheet): the tool's form (tools/options),
 * the error of the options as they are, why the last run
 * ended without a result, and [Start] ([Find] for blank pages). Failures read
 * as errors (ProblemNote); [Start] stays in a row stuck to the bottom of the
 * sheet's scroll area, so a long form never hides it below the fold.
 */
import type { ReactNode } from 'react'
import { Sheet } from '../../components/Sheet'
import { useMobileLocale, type MobileStringKey } from '../../i18n'
import type { MobilePdfToolId } from '../catalog'
import type { ToolOptionsError } from '../options'
import { optionsErrorKey } from './format'
import { ProblemNote } from './ProblemNote'

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
        {error &&
          (FIELD_ERRORS.has(error) ? (
            <p className="mobile-sr-only" role="alert" data-testid="pdf-tools-options-error">
              {t(optionsErrorKey(error))}
            </p>
          ) : (
            <ProblemNote role="alert" testId="pdf-tools-options-error">
              {t(optionsErrorKey(error))}
            </ProblemNote>
          ))}
        {notice && (
          <ProblemNote role="alert" testId="pdf-tools-notice">
            {t(notice)}
          </ProblemNote>
        )}
        <div className="pdf-tools-step-actions pdf-tools-sheet-actions">
          <button type="button" className="mobile-touch-btn mobile-btn-primary" onClick={onStart}>
            {t(finding ? 'pdfToolsFindBlank' : 'pdfToolsStart')}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
