// "Go to page" sheet: a page number, checked against the page count.
import { useEffect, useState } from 'react'
import type { Params } from '@genoffice/i18n'
import { Sheet } from '../../../components/Sheet'
import type { MobileStringKey } from '../../../i18n/strings'

/** 1-based page number typed by the person → 0-based index, or null when out of range. */
export function parseGoToPage(input: string, pageCount: number): number | null {
  const text = input.trim()
  if (!/^\d+$/.test(text)) return null
  const n = Number(text)
  return n >= 1 && n <= pageCount ? n - 1 : null
}

export function PdfGoToPageSheet({
  open,
  pageCount,
  currentPage,
  t,
  onGo,
  onClose,
}: {
  readonly open: boolean
  readonly pageCount: number
  /** 0-based. */
  readonly currentPage: number
  readonly t: (key: MobileStringKey, params?: Params) => string
  readonly onGo: (pageIndex: number) => void
  readonly onClose: () => void
}) {
  const [value, setValue] = useState('')
  const [invalid, setInvalid] = useState(false)
  useEffect(() => {
    if (open) {
      setValue(String(currentPage + 1))
      setInvalid(false)
    }
  }, [open, currentPage])

  const submit = () => {
    const index = parseGoToPage(value, pageCount)
    if (index === null) {
      setInvalid(true)
      return
    }
    onClose()
    onGo(index)
  }

  return (
    <Sheet
      open={open}
      title={t('pdfViewGoToPage')}
      closeLabel={t('cancel')}
      onClose={onClose}
      testId="pdf-goto-sheet"
    >
      <form
        className="m-pdf-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label className="m-pdf-field">
          <span>{t('pdfViewGoToPageLabel', { count: pageCount })}</span>
          <input
            className="mobile-input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={value}
            // the field starts with the current page: a tap selects it so typing replaces it
            onFocus={(e) => e.currentTarget.select()}
            aria-invalid={invalid}
            onChange={(e) => {
              setValue(e.target.value)
              setInvalid(false)
            }}
            data-testid="pdf-goto-input"
          />
        </label>
        {invalid && (
          <p className="m-pdf-error" role="alert">
            {t('pdfViewGoToPageInvalid', { count: pageCount })}
          </p>
        )}
        <div className="mobile-row-actions">
          <button
            type="submit"
            className="mobile-touch-btn mobile-btn-primary"
            data-testid="pdf-goto-submit"
          >
            {t('pdfViewGoToPageGo')}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
