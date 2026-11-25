// Save As: what the copy does with annotations (spec 3.11, the PC "Save a copy"
// dialog): keep them editable (default), bake them into the pages, or leave them out.
import { useEffect, useState } from 'react'
import type { Params } from '@genoffice/i18n'
import { Sheet } from '../../../components/Sheet'
import type { MobileStringKey } from '../../../i18n/strings'
import type { PdfAnnotationChoice } from './types'

const CHOICES: readonly { readonly value: PdfAnnotationChoice; readonly key: MobileStringKey }[] = [
  { value: 'keep', key: 'pdfEditKeepAnnots' },
  { value: 'flatten', key: 'pdfEditFlattenAnnots' },
  { value: 'strip', key: 'pdfEditStripAnnots' },
]

export function PdfSaveAsSheet({
  open,
  t,
  onChoose,
  onCancel,
}: {
  readonly open: boolean
  readonly t: (key: MobileStringKey, params?: Params) => string
  readonly onChoose: (choice: PdfAnnotationChoice) => void
  readonly onCancel: () => void
}) {
  const [choice, setChoice] = useState<PdfAnnotationChoice>('keep')
  useEffect(() => {
    if (open) setChoice('keep')
  }, [open])

  return (
    <Sheet
      open={open}
      title={t('saveAs')}
      closeLabel={t('cancel')}
      onClose={onCancel}
      testId="pdf-save-as-sheet"
    >
      <div className="mobile-choice-sheet">
        <p className="m-pdf-edit-hint">{t('pdfEditSaveAsHint')}</p>
        <div className="m-pdf-edit-choices" role="radiogroup" aria-label={t('saveAs')}>
          {CHOICES.map((item) => (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={choice === item.value}
              className="mobile-choice-btn m-pdf-edit-choice"
              onClick={() => setChoice(item.value)}
              data-testid={`pdf-save-as-${item.value}`}
            >
              {t(item.key)}
            </button>
          ))}
        </div>
        <div className="mobile-row-actions">
          <button
            type="button"
            className="mobile-touch-btn mobile-btn-primary"
            onClick={() => onChoose(choice)}
            data-testid="pdf-save-as-confirm"
          >
            {t('save')}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
