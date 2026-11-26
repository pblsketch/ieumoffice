import { createPortal } from 'react-dom'
import { Sheet } from '../components/Sheet'
import { IconCheck } from '../components/MobileIcons'
import { useMobileLocale } from '../i18n'
import type { MobileCurrentModel, MobileModelGroup } from './modelChoice'
import './aiPanelParts.css'

export interface ModelPickerSheetProps {
  readonly open: boolean
  readonly groups: readonly MobileModelGroup[]
  readonly current: MobileCurrentModel | null
  readonly onChoose: (provider: string, model: string) => void
  readonly onClose: () => void
}

/**
 * The model sheet of the AI panel: every connected provider with its models.
 * Choosing one saves it as the AI in use; the next turn runs on it. Portaled
 * to the body so it sits over the AI sheet on a phone.
 */
export function ModelPickerSheet({
  open,
  groups,
  current,
  onChoose,
  onClose,
}: ModelPickerSheetProps) {
  const { t } = useMobileLocale()
  const sheet = (
    <Sheet
      open={open}
      title={t('aiModelPickTitle')}
      closeLabel={t('cancel')}
      onClose={onClose}
      testId="ai-model-sheet"
    >
      {groups.length === 0 ? (
        <p className="mobile-ai-parts-muted">{t('aiModelNone')}</p>
      ) : (
        <div className="mobile-ai-model-groups">
          {groups.map((group) => (
            <section
              key={group.provider}
              className="mobile-ai-model-group"
              data-provider={group.provider}
            >
              <h3 className="mobile-ai-model-group-title">
                {group.provider === 'custom' ? t('aiModelCustomServer') : group.label}
                {group.free && <span className="mobile-ai-model-free">{t('aiModelFreeTag')}</span>}
              </h3>
              <ul className="mobile-ai-model-list">
                {group.models.map((model) => {
                  const selected = current?.provider === group.provider && current.model === model
                  return (
                    <li key={model}>
                      <button
                        type="button"
                        className="mobile-ai-model-option"
                        data-testid="ai-model-option"
                        data-provider={group.provider}
                        data-model={model}
                        aria-pressed={selected}
                        onClick={() => onChoose(group.provider, model)}
                      >
                        <span className="mobile-ai-model-name" dir="auto">
                          {model}
                        </span>
                        {selected && <IconCheck size={18} />}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Sheet>
  )
  return typeof document === 'undefined' ? sheet : createPortal(sheet, document.body)
}
