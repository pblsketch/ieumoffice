// The link target sheet (spec 3.10, PC LinkDialog): an outside address or a page of
// this document; typing one clears the other. Editing a pending link adds Delete.
import { useState } from 'react'
import type { Params } from '@genoffice/i18n'
import { Sheet } from '../../../../components/Sheet'
import type { MobileStringKey } from '../../../../i18n/strings'
import { resolveLinkTarget, type PdfLinkTarget, type PdfLinkTargetError } from './linkTarget'

const ERROR_KEYS: Readonly<Record<PdfLinkTargetError, MobileStringKey>> = {
  empty: 'pdfLinkNeedTarget',
  url: 'pdfLinkUrlInvalid',
  page: 'pdfLinkPageInvalid',
}

export function PdfLinkSheet({
  title,
  visiblePages,
  initialUrl = '',
  initialPage = '',
  t,
  onApply,
  onDelete,
  onClose,
}: {
  readonly title: string
  /** Visible position → original page index (the page field counts these). */
  readonly visiblePages: readonly number[]
  readonly initialUrl?: string
  readonly initialPage?: string
  readonly t: (key: MobileStringKey, params?: Params) => string
  readonly onApply: (target: PdfLinkTarget) => void
  /** Present when a pending link is being edited. */
  readonly onDelete?: () => void
  readonly onClose: () => void
}) {
  const [url, setUrl] = useState(initialUrl)
  const [page, setPage] = useState(initialPage)
  const [error, setError] = useState<PdfLinkTargetError | null>(null)
  const count = visiblePages.length

  const submit = () => {
    const result = resolveLinkTarget(url, page, visiblePages)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onApply(result.target)
  }

  return (
    <Sheet open title={title} closeLabel={t('cancel')} onClose={onClose} testId="pdf-link-sheet">
      <form
        className="m-pdf-form"
        // the URL keyboard without the browser's own URL check: "www." is accepted here
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label className="m-pdf-field">
          <span>{t('pdfLinkUrlLabel')}</span>
          <input
            className="mobile-input"
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://…"
            value={url}
            aria-invalid={error === 'url'}
            onChange={(e) => {
              setUrl(e.target.value)
              if (e.target.value.trim() !== '') setPage('')
              setError(null)
            }}
            data-testid="pdf-link-url"
          />
        </label>
        <label className="m-pdf-field">
          <span>{t('pdfLinkPageLabel', { count })}</span>
          <input
            className="mobile-input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={page}
            aria-invalid={error === 'page'}
            onChange={(e) => {
              const digits = e.target.value.replace(/[^0-9]/g, '')
              setPage(digits)
              if (digits !== '') setUrl('')
              setError(null)
            }}
            data-testid="pdf-link-page"
          />
        </label>
        {error && (
          <p className="m-pdf-error" role="alert" data-testid="pdf-link-error">
            {t(ERROR_KEYS[error], { count })}
          </p>
        )}
        <div className="mobile-row-actions">
          {onDelete && (
            <button
              type="button"
              className="mobile-touch-btn"
              onClick={onDelete}
              data-testid="pdf-link-delete"
            >
              {t('pdfLinkDelete')}
            </button>
          )}
          <button
            type="submit"
            className="mobile-touch-btn mobile-btn-primary"
            data-testid="pdf-link-apply"
          >
            {t(onDelete ? 'pdfLinkUpdate' : 'pdfLinkApply')}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
