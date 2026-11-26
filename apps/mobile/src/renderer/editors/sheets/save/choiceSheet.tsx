/**
 * The save area's questions: which format a Save As or a share produces,
 * the CSV question of every CSV save, the CSV formula warning and the ODS
 * feature-loss warning (the desktop asks these in native dialogs). A save
 * can run while the editor screen is not mounted, so each question gets its
 * own small root on `document.body` with the shared `Sheet` (like the
 * password sheet of `open/overlays.tsx`), removed when answered.
 */
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Sheet } from '../../../components/Sheet'
import './save.css'

export interface SheetsChoice<T extends string> {
  readonly id: T
  readonly label: string
  /** A second line under the label (what the choice leaves out, or why it is off). */
  readonly detail?: string
  readonly disabled?: boolean
}

export interface SheetsChoiceRequest<T extends string> {
  readonly title: string
  readonly message?: string
  readonly choices: readonly SheetsChoice<T>[]
  readonly cancelLabel: string
  readonly testId: string
}

function ChoiceSheet<T extends string>({
  request,
  onPick,
}: {
  readonly request: SheetsChoiceRequest<T>
  readonly onPick: (id: T | null) => void
}) {
  return (
    <Sheet
      open
      title={request.title}
      onClose={() => onPick(null)}
      closeLabel={request.cancelLabel}
      testId={request.testId}
    >
      <div className="m-sheets-choice">
        {request.message ? <p className="m-sheets-choice-message">{request.message}</p> : null}
        <div className="m-sheets-choice-list" role="list">
          {request.choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              role="listitem"
              className="m-sheets-choice-row"
              disabled={choice.disabled}
              aria-disabled={choice.disabled}
              data-choice={choice.id}
              onClick={() => onPick(choice.id)}
            >
              <span className="m-sheets-choice-label">{choice.label}</span>
              {choice.detail ? (
                <span className="m-sheets-choice-detail">{choice.detail}</span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="m-sheets-choice-actions">
          <button
            type="button"
            className="mobile-pill-btn mobile-btn-ghost m-sheets-choice-cancel"
            data-choice="cancel"
            onClick={() => onPick(null)}
          >
            {request.cancelLabel}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

/** Shows the question; resolves with the picked choice, or `null` when cancelled. */
export function askSheetsChoice<T extends string>(
  request: SheetsChoiceRequest<T>,
): Promise<T | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    host.dataset.testid = `${request.testId}-root`
    document.body.appendChild(host)
    const root = createRoot(host)
    let done = false
    const finish = (id: T | null) => {
      if (done) return
      done = true
      // After this render pass: unmounting a root from inside its own event handler warns.
      setTimeout(() => {
        root.unmount()
        host.remove()
      }, 0)
      resolve(id)
    }
    flushSync(() => root.render(<ChoiceSheet request={request} onPick={finish} />))
  })
}
