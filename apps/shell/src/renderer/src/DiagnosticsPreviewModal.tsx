import type { Lang } from '@genoffice/i18n'
import { diagnosticsUiText } from './i18n/strings-diagnostics'
import './diagnostics-preview-modal.css'

export interface DiagnosticsPreviewPayload {
  readonly files: readonly {
    readonly name: string
    readonly content: string
    readonly bytes: number
  }[]
  readonly summaryText: string
}

export function DiagnosticsPreviewModal({
  lang,
  preview,
  saving,
  onSave,
  onClose,
}: {
  readonly lang: Lang
  readonly preview: DiagnosticsPreviewPayload
  readonly saving: boolean
  readonly onSave: () => void
  readonly onClose: () => void
}) {
  return (
    <div
      className="diag-backdrop"
      role="dialog"
      aria-modal="true"
      data-testid="diagnostics-preview-modal"
    >
      <div className="diag-modal">
        <h3 className="diag-title">{diagnosticsUiText(lang, 'previewTitle')}</h3>
        <p className="diag-notice">{diagnosticsUiText(lang, 'previewNotice')}</p>
        <div className="diag-files">
          {preview.files.map((file) => (
            <div key={file.name} className="diag-file-box">
              <div className="diag-file-name">
                {file.name} ({file.bytes} B)
              </div>
              <pre className="diag-file-pre">{file.content || '(empty)'}</pre>
            </div>
          ))}
        </div>
        <div className="diag-actions">
          <button type="button" className="set-btn" onClick={onClose} disabled={saving}>
            {diagnosticsUiText(lang, 'cancelBtn')}
          </button>
          <button
            type="button"
            className="set-btn set-btn-primary"
            onClick={onSave}
            disabled={saving}
          >
            {diagnosticsUiText(lang, 'saveZipBtn')}
          </button>
        </div>
      </div>
    </div>
  )
}
