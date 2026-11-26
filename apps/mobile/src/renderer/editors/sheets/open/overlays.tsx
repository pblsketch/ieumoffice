/**
 * What a spreadsheet shows while `open()` runs, before App has a document to
 * render: the progress line of a large file and the password sheet. `open()`
 * is not inside App's React tree, so each gets its own small root on
 * `document.body` (the shared `Sheet` component, as S0 planned for the
 * password prompt) and removes it when done.
 *
 * The password sheet has no Back layer: App's back stack belongs to App's
 * tree. Its close button, Escape and [Cancel] all cancel the open.
 */
import { useState, type FormEvent } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { MobileCommandError } from '@genoffice/mobile-bridge/transport'
import { Sheet } from '../../../components/Sheet'
import type { MobileStringKey } from '../../../i18n'
import { ActiveBackStackPortal } from '../../../shell/backStack'
import './open.css'

export type SheetsTranslate = (key: MobileStringKey) => string

function mount(testId: string): { root: Root; remove(): void } {
  const host = document.createElement('div')
  host.dataset.testid = testId
  document.body.appendChild(host)
  const root = createRoot(host)
  return {
    root,
    remove() {
      root.unmount()
      host.remove()
    },
  }
}

/** How long a quick open runs before the progress line appears (no flash for small files). */
export const OPEN_PROGRESS_DELAY_MS = 400

export interface OpenProgress {
  /** Hides the line while something else asks (the password sheet). */
  pause(): void
  resume(): void
  close(): void
}

/** Shows `text` as a status line once the open has taken `delayMs`. */
export function showOpenProgress(text: string, delayMs = OPEN_PROGRESS_DELAY_MS): OpenProgress {
  let mounted: ReturnType<typeof mount> | null = null
  let paused = false
  let closed = false
  const render = () => {
    if (closed || paused || mounted) return
    mounted = mount('sheets-open-progress')
    flushSync(() =>
      mounted?.root.render(
        <div className="m-sheets-open-progress" role="status" aria-live="polite">
          <span className="m-sheets-open-spinner" aria-hidden="true" />
          <span>{text}</span>
        </div>,
      ),
    )
  }
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    timer = null
    render()
  }, delayMs)
  const hide = () => {
    mounted?.remove()
    mounted = null
  }
  return {
    pause() {
      paused = true
      hide()
    },
    resume() {
      paused = false
      if (timer === null) render()
    },
    close() {
      closed = true
      if (timer !== null) clearTimeout(timer)
      hide()
    },
  }
}

/** The error `open()` throws when the person cancels: App passes it by without a notice. */
export function userCancelled(): MobileCommandError {
  return new MobileCommandError({
    code: 'USER_CANCELLED',
    messageKey: 'mobile.sheets.passwordCancelled',
    detail: 'The password prompt was cancelled.',
  })
}

function PasswordSheet({
  t,
  retry,
  onSubmit,
  onCancel,
}: {
  readonly t: SheetsTranslate
  readonly retry: boolean
  readonly onSubmit: (password: string) => void
  readonly onCancel: () => void
}) {
  const [password, setPassword] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (password.length > 0) onSubmit(password)
  }
  return (
    <Sheet
      open
      title={t('sheetsPasswordTitle')}
      onClose={onCancel}
      closeLabel={t('sheetsPasswordCancel')}
      testId="sheets-password-sheet"
    >
      <form className="m-sheets-password" onSubmit={submit}>
        {retry ? (
          <p className="m-sheets-password-wrong" role="alert">
            {t('sheetsPasswordWrong')}
          </p>
        ) : (
          <p className="m-sheets-password-message">{t('sheetsPasswordMessage')}</p>
        )}
        <label className="m-sheets-password-field">
          <span>{t('sheetsPasswordLabel')}</span>
          <input
            className="mobile-input"
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            data-testid="sheets-password-input"
          />
        </label>
        <div className="m-sheets-password-actions">
          <button
            type="button"
            className="mobile-pill-btn mobile-btn-ghost m-sheets-password-btn"
            onClick={onCancel}
          >
            {t('sheetsPasswordCancel')}
          </button>
          <button
            type="submit"
            className="mobile-pill-btn mobile-btn-primary m-sheets-password-btn"
            disabled={password.length === 0}
            data-testid="sheets-password-open"
          >
            {t('sheetsPasswordOpen')}
          </button>
        </div>
      </form>
    </Sheet>
  )
}

/**
 * Asks for the workbook's password. Resolves with what was typed; rejects
 * with `USER_CANCELLED` when the person cancels. `retry` shows that the last
 * password did not open the file.
 */
export function askSheetsPassword(t: SheetsTranslate, retry: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const mounted = mount('sheets-password')
    let done = false
    const finish = (result: { password: string } | null) => {
      if (done) return
      done = true
      // Drop the field's focus first, so the on-screen keyboard closes with the sheet.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      // After this render pass: unmounting a root from inside its own event handler warns.
      setTimeout(() => mounted.remove(), 0)
      if (result) resolve(result.password)
      else reject(userCancelled())
    }
    flushSync(() =>
      mounted.root.render(
        <ActiveBackStackPortal>
          <PasswordSheet
            t={t}
            retry={retry}
            onSubmit={(password) => finish({ password })}
            onCancel={() => finish(null)}
          />
        </ActiveBackStackPortal>,
      ),
    )
  })
}
