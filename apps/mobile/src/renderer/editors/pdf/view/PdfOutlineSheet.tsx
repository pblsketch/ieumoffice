// Outline sheet: the document's bookmarks as an indented list; a tap goes there.
import { useEffect, useState, type CSSProperties } from 'react'
import { Sheet } from '../../../components/Sheet'
import type { MobileStringKey } from '../../../i18n/strings'
import type { PdfOpenedDocument } from './model'
import { loadPdfOutline, type PdfOutlineRow } from './outline'

export function PdfOutlineSheet({
  open,
  model,
  t,
  onGoToDest,
  onOpenExternalUrl,
  onClose,
}: {
  readonly open: boolean
  readonly model: PdfOpenedDocument
  readonly t: (key: MobileStringKey) => string
  readonly onGoToDest: (dest: unknown) => void
  readonly onOpenExternalUrl?: (url: string) => void
  readonly onClose: () => void
}) {
  const [rows, setRows] = useState<PdfOutlineRow[] | null>(null)
  useEffect(() => {
    if (!open || rows !== null) return
    let cancelled = false
    void loadPdfOutline(model.proxy).then((loaded) => {
      if (!cancelled) setRows(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [open, rows, model])

  return (
    <Sheet
      open={open}
      title={t('pdfViewOutline')}
      closeLabel={t('cancel')}
      onClose={onClose}
      testId="pdf-outline-sheet"
    >
      {rows === null ? (
        <p className="m-pdf-sheet-note" role="status">
          {t('pdfViewLoading')}
        </p>
      ) : rows.length === 0 ? (
        <p className="m-pdf-sheet-note" role="status">
          {t('pdfViewOutlineEmpty')}
        </p>
      ) : (
        <div className="m-pdf-outline" role="tree" aria-label={t('pdfViewOutline')}>
          {rows.map((row, i) => {
            const style = { '--m-pdf-depth': row.depth } as CSSProperties
            const className = [
              'm-pdf-outline-row',
              row.bold ? 'is-bold' : '',
              row.italic ? 'is-italic' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return row.url ? (
              <a
                key={i}
                role="treeitem"
                aria-level={row.depth + 1}
                className={className}
                style={style}
                href={row.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  if (onOpenExternalUrl) {
                    e.preventDefault()
                    onOpenExternalUrl(row.url!)
                  }
                  onClose()
                }}
              >
                {row.title}
              </a>
            ) : (
              <button
                key={i}
                type="button"
                role="treeitem"
                aria-level={row.depth + 1}
                className={className}
                style={style}
                disabled={row.dest === null}
                onClick={() => {
                  onClose()
                  onGoToDest(row.dest)
                }}
                data-testid="pdf-outline-row"
              >
                {row.title}
              </button>
            )
          })}
        </div>
      )}
    </Sheet>
  )
}
