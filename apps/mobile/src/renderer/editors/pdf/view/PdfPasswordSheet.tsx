// Password sheet for an encrypted PDF. It is asked while the file opens — before
// the app switches documents — so it mounts on its own and answers through a promise:
// a cancel means the file does not open at all.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Lang, Params } from '@genoffice/i18n'
import { Sheet } from '../../../components/Sheet'
import { translateMobile, type MobileStringKey } from '../../../i18n/strings'
import type { PdfPasswordPrompt } from '../openTypes'
import { IconPdfEye, IconPdfEyeOff } from './icons'

export function PdfPasswordSheet({
  fileName,
  wrong,
  t,
  onSubmit,
  onCancel,
}: {
  readonly fileName: string
  /** The previous password was not the right one. */
  readonly wrong: boolean
  readonly t: (key: MobileStringKey, params?: Params) => string
  readonly onSubmit: (password: string) => void
  readonly onCancel: () => void
}) {
  const [value, setValue] = useState('')
  const [show, setShow] = useState(false)
  return (
    <Sheet
      open
      title={t('pdfViewPasswordTitle')}
      closeLabel={t('cancel')}
      onClose={onCancel}
      testId="pdf-password-sheet"
    >
      <form
        className="m-pdf-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (value) onSubmit(value)
        }}
      >
        <p className="m-pdf-sheet-note">{t('pdfViewPasswordBody', { name: fileName })}</p>
        <label className="m-pdf-field">
          <span>{t('pdfViewPasswordLabel')}</span>
          <span className="m-pdf-password-row">
            <input
              className="mobile-input"
              type={show ? 'text' : 'password'}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              // the sheet opens because the person asked to open this file
              autoFocus
              value={value}
              aria-invalid={wrong}
              placeholder={t('pdfViewPasswordPlaceholder')}
              onChange={(e) => setValue(e.target.value)}
              data-testid="pdf-password-input"
            />
            <button
              type="button"
              className="mobile-icon-btn"
              onClick={() => setShow((prev) => !prev)}
              aria-label={show ? t('pdfViewPasswordHide') : t('pdfViewPasswordShow')}
              aria-pressed={show}
            >
              {show ? <IconPdfEyeOff size={20} /> : <IconPdfEye size={20} />}
            </button>
          </span>
        </label>
        {wrong && (
          <p className="m-pdf-error" role="alert" data-testid="pdf-password-wrong">
            {t('pdfViewPasswordWrong')}
          </p>
        )}
        <div className="mobile-row-actions">
          <button
            type="button"
            className="mobile-touch-btn mobile-btn-ghost"
            onClick={onCancel}
            data-testid="pdf-password-cancel"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            className="mobile-touch-btn mobile-btn-primary"
            disabled={!value}
            data-testid="pdf-password-submit"
          >
            {t('pdfViewPasswordOpen')}
          </button>
        </div>
      </form>
    </Sheet>
  )
}

/** A password prompt that shows PdfPasswordSheet over the app in `lang`. */
export function createSheetPasswordPrompt(lang: Lang): PdfPasswordPrompt {
  const t = (key: MobileStringKey, params?: Params) => translateMobile(lang, key, params)
  return ({ fileName, wrong }) =>
    new Promise<string | null>((resolve) => {
      const host = document.createElement('div')
      host.className = 'm-pdf-password-host'
      document.body.appendChild(host)
      const root = createRoot(host)
      let settled = false
      const finish = (answer: string | null) => {
        if (settled) return
        settled = true
        // unmount after the event that answered has finished
        setTimeout(() => {
          root.unmount()
          host.remove()
        }, 0)
        resolve(answer)
      }
      root.render(
        <PdfPasswordSheet
          fileName={fileName}
          wrong={wrong}
          t={t}
          onSubmit={(password) => finish(password)}
          onCancel={() => finish(null)}
        />,
      )
    })
}
