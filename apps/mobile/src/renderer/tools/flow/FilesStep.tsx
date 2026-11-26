/**
 * The files step (spec 5.3, files): [Add files] opens the system
 * picker (no permission prompt), each row shows the file's size and pages or
 * why the tool cannot use it, and tools that take several files get
 * [Up][Down][Remove] buttons. Rows with a problem stay visible but are
 * skipped; [Next] waits for enough usable files.
 */
import { useRef } from 'react'
import type { InspectResult } from '../engine/types'
import { IconChevronDown, IconClose } from '../../components/MobileIcons'
import { useMobileLocale, type MobileStringKey } from '../../i18n'
import type { ToolFile } from '../engine/types'
import type { MobilePdfToolId } from '../catalog'
import { formatBytes, problemKey } from './format'

export interface FileEntry {
  readonly id: number
  readonly file: ToolFile
  readonly sizeBytes: number | null
  /** 'pending' until the engine has looked at the file */
  readonly check: 'pending' | InspectResult
}

export interface FilesStepProps {
  readonly tool: MobilePdfToolId
  readonly entries: readonly FileEntry[]
  readonly takesMany: boolean
  readonly inputKind: 'pdf' | 'image'
  readonly canNext: boolean
  onAdd(files: File[]): void
  onMove(id: number, by: -1 | 1): void
  onRemove(id: number): void
  onNext(): void
}

function hintKey(tool: MobilePdfToolId): MobileStringKey {
  switch (tool) {
    case 'merge':
      return 'pdfToolsHintMerge'
    case 'imagesToPdf':
      return 'pdfToolsHintPhotos'
    case 'decrypt':
      return 'pdfToolsHintDecrypt'
    case 'repair':
      return 'pdfToolsHintRepair'
    default:
      return 'pdfToolsHintOne'
  }
}

export function FilesStep({
  tool,
  entries,
  takesMany,
  inputKind,
  canNext,
  onAdd,
  onMove,
  onRemove,
  onNext,
}: FilesStepProps) {
  const { t, lang } = useMobileLocale()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const addLabel =
    !takesMany && entries.length > 0 ? t('pdfToolsReplaceFile') : t('pdfToolsAddFiles')

  const meta = (entry: FileEntry): string => {
    const parts: string[] = []
    if (entry.sizeBytes !== null) parts.push(formatBytes(entry.sizeBytes, lang))
    if (entry.check === 'pending') parts.push(t('pdfToolsRunning'))
    else if (entry.check.ok && inputKind === 'pdf') {
      parts.push(
        entry.check.pages === 1
          ? t('pdfToolsPageCountOne')
          : t('pdfToolsPageCount', { n: entry.check.pages }),
      )
    }
    return parts.join(' · ')
  }

  return (
    <div className="pdf-tools-files" data-testid="pdf-tools-files">
      <p className="mobile-muted">{t(hintKey(tool))}</p>
      {entries.length > 0 && (
        <ul className="pdf-tools-file-list">
          {entries.map((entry, index) => {
            const nameId = `pdf-tools-file-${entry.id}`
            const problem =
              entry.check !== 'pending' && !entry.check.ok ? entry.check.problem : null
            return (
              <li
                key={entry.id}
                className="pdf-tools-file-row"
                data-testid="pdf-tools-file-row"
                data-problem={problem ?? undefined}
                aria-busy={entry.check === 'pending' ? 'true' : undefined}
              >
                <div className="pdf-tools-file-text">
                  <span id={nameId} className="pdf-tools-file-name">
                    {entry.file.name}
                  </span>
                  <span className="pdf-tools-file-meta">{meta(entry)}</span>
                  {problem && (
                    <span className="pdf-tools-file-problem">{t(problemKey(problem))}</span>
                  )}
                </div>
                {takesMany && (
                  <div className="pdf-tools-file-actions">
                    <button
                      type="button"
                      className="mobile-icon-btn"
                      aria-label={t('pdfToolsMoveUp')}
                      title={t('pdfToolsMoveUp')}
                      aria-describedby={nameId}
                      disabled={index === 0}
                      onClick={() => onMove(entry.id, -1)}
                    >
                      <IconChevronDown size={20} className="pdf-tools-icon-up" />
                    </button>
                    <button
                      type="button"
                      className="mobile-icon-btn"
                      aria-label={t('pdfToolsMoveDown')}
                      title={t('pdfToolsMoveDown')}
                      aria-describedby={nameId}
                      disabled={index === entries.length - 1}
                      onClick={() => onMove(entry.id, 1)}
                    >
                      <IconChevronDown size={20} />
                    </button>
                    <button
                      type="button"
                      className="mobile-icon-btn"
                      aria-label={t('pdfToolsRemove')}
                      title={t('pdfToolsRemove')}
                      aria-describedby={nameId}
                      onClick={() => onRemove(entry.id)}
                    >
                      <IconClose size={20} />
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <div className="pdf-tools-step-actions">
        <button
          type="button"
          className="mobile-touch-btn mobile-btn-secondary"
          onClick={() => inputRef.current?.click()}
        >
          {addLabel}
        </button>
        <button
          type="button"
          className="mobile-touch-btn mobile-btn-primary"
          disabled={!canNext}
          onClick={onNext}
        >
          {t('pdfToolsNext')}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        hidden
        data-testid="pdf-tools-file-input"
        accept={inputKind === 'image' ? 'image/*' : 'application/pdf,.pdf'}
        multiple={takesMany}
        onChange={(e) => {
          const picked = [...(e.currentTarget.files ?? [])]
          // the same file can be picked again later
          e.currentTarget.value = ''
          if (picked.length > 0) onAdd(picked)
        }}
      />
    </div>
  )
}
