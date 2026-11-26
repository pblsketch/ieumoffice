// Taking pages from another PDF (spec 3.9): where they go, then the confirmation that
// the edits so far are saved first and the pages land in the file at once (PC
// Import pages). Cancel changes nothing.
import type { Params } from '@genoffice/i18n'
import { Sheet } from '../../../../components/Sheet'
import type { MobileStringKey } from '../../../../i18n/strings'
import type { ImportPlace } from './pageOps'

export interface ImportDraft {
  readonly other: Uint8Array
  readonly pageCount: number
  readonly place: ImportPlace
  /** The last picked page and its visible number, offered as "after page N". */
  readonly anchor: { readonly page: number; readonly number: number } | null
}

const samePlace = (a: ImportPlace, b: ImportPlace) =>
  a.kind === b.kind && (a.kind !== 'after' || (b.kind === 'after' && a.page === b.page))

export function ImportSheet({
  draft,
  t,
  onPlace,
  onConfirm,
  onCancel,
}: {
  readonly draft: ImportDraft | null
  readonly t: (key: MobileStringKey, params?: Params) => string
  readonly onPlace: (place: ImportPlace) => void
  readonly onConfirm: () => void
  readonly onCancel: () => void
}) {
  const places: { readonly place: ImportPlace; readonly label: string; readonly id: string }[] =
    draft
      ? [
          { place: { kind: 'front' }, label: t('pdfPagesImportFront'), id: 'front' },
          ...(draft.anchor
            ? [
                {
                  place: { kind: 'after', page: draft.anchor.page } as const,
                  label: t('pdfPagesImportAfter', { n: draft.anchor.number }),
                  id: 'after',
                },
              ]
            : []),
          { place: { kind: 'end' }, label: t('pdfPagesImportEnd'), id: 'end' },
        ]
      : []
  return (
    <Sheet
      open={draft !== null}
      title={t('pdfPagesImportTitle')}
      closeLabel={t('cancel')}
      onClose={onCancel}
      testId="pdf-pages-import-sheet"
    >
      {draft ? (
        <div className="mobile-choice-sheet">
          <p className="m-pdf-edit-hint">{t('pdfPagesImportCount', { n: draft.pageCount })}</p>
          <div
            className="m-pdf-edit-choices"
            role="radiogroup"
            aria-label={t('pdfPagesImportPlace')}
          >
            {places.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={samePlace(draft.place, item.place)}
                className="mobile-choice-btn m-pdf-edit-choice"
                onClick={() => onPlace(item.place)}
                data-testid={`pdf-pages-import-${item.id}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="m-pdf-edit-hint" data-testid="pdf-pages-import-notice">
            {t('pdfPagesImportConfirmHint')}
          </p>
          <div className="mobile-row-actions">
            <button
              type="button"
              className="mobile-touch-btn mobile-btn-secondary"
              onClick={onCancel}
              data-testid="pdf-pages-import-cancel"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              className="mobile-touch-btn mobile-btn-primary"
              onClick={onConfirm}
              data-testid="pdf-pages-import-confirm"
            >
              {t('pdfPagesImportConfirm')}
            </button>
          </div>
        </div>
      ) : null}
    </Sheet>
  )
}
