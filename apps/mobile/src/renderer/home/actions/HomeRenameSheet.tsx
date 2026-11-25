import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Sheet } from '../../components/Sheet'
import { useMobileLocale, type MobileStringKey } from '../../i18n'
import { homeActErrorKeyOf, splitFileName, validateBaseName } from './items'
import './homeActions.css'

export interface HomeRenameSheetProps {
  readonly open: boolean
  /** Current file name, extension included. */
  readonly name: string
  readonly onClose: () => void
  /**
   * Renames to `newBaseName` (the extension stays). Resolve when done (the caller closes the
   * sheet); reject with the backend error and the sheet shows its reason.
   */
  readonly onRename: (newBaseName: string) => Promise<void>
}

/**
 * Rename sheet (spec 3.6): edits the base name only and shows the extension read-only. Empty names
 * and names with `/` or `\` are refused here; the backend's refusals come back by messageKey.
 */
export function HomeRenameSheet({ open, name, onClose, onRename }: HomeRenameSheetProps) {
  const { t } = useMobileLocale()
  const { base, ext } = splitFileName(name)
  const [value, setValue] = useState(base)
  const [errorKey, setErrorKey] = useState<MobileStringKey | null>(null)
  const [pending, setPending] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const errorId = useId()

  useEffect(() => {
    if (!open) return
    setValue(base)
    setErrorKey(null)
    setPending(false)
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [open, base])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    const refused = validateBaseName(value)
    if (refused) {
      setErrorKey(refused)
      return
    }
    const next = value.trim()
    if (next === base) {
      onClose()
      return
    }
    setPending(true)
    setErrorKey(null)
    try {
      await onRename(next)
    } catch (err) {
      setErrorKey(homeActErrorKeyOf(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <Sheet
      open={open}
      title={t('homeActRename')}
      closeLabel={t('homeActCancel')}
      onClose={onClose}
      testId="home-act-rename-sheet"
    >
      <form className="home-act-form" onSubmit={(event) => void submit(event)}>
        <div className="home-act-name-field">
          <input
            ref={inputRef}
            className="mobile-input"
            data-testid="home-act-rename-input"
            aria-label={t('homeActNewName')}
            aria-invalid={errorKey !== null}
            aria-describedby={errorKey ? errorId : undefined}
            value={value}
            onChange={(event) => {
              setValue(event.target.value)
              setErrorKey(null)
            }}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          {ext && (
            <span className="home-act-name-ext" data-testid="home-act-rename-ext">
              {ext}
            </span>
          )}
        </div>
        {errorKey && (
          <p
            id={errorId}
            className="home-act-form-error"
            role="alert"
            data-testid="home-act-rename-error"
          >
            {t(errorKey)}
          </p>
        )}
        <div className="home-act-form-actions">
          <button type="button" className="mobile-touch-btn mobile-btn-ghost" onClick={onClose}>
            {t('homeActCancel')}
          </button>
          <button
            type="submit"
            className="mobile-touch-btn mobile-btn-primary"
            data-testid="home-act-rename-submit"
            disabled={pending}
          >
            {t('homeActRenameSave')}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
