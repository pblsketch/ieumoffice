// Owner: track T6. "Editors" rows of the general card: one switch per editor kind and the PDF tools (spec 3.10).
import { useId } from 'react'
import type { EditorKind } from '../../editors/editorKind'
import { EDITOR_KINDS } from '../../editors/registry'
import { useHomeRuntime } from '../../home/homeRuntime'
import { PDF_TOOLS_ID, setEditorOn, updateHomePrefs } from '../../home/prefsStore'
import { useMobileLocale } from '../../i18n'
import { editorLabel, nextEditorsOff } from './homeSettingsModel'
import { useSettingsPrefs } from './settingsHooks'
import './homeSettings.css'

export interface EditorsRowsProps {
  /** The registry's kinds; tests may pass their own. */
  readonly kinds?: readonly EditorKind[]
}

export function EditorsRows({ kinds = EDITOR_KINDS }: EditorsRowsProps) {
  const { t } = useMobileLocale()
  const runtime = useHomeRuntime()
  const { prefs, isEditorOn } = useSettingsPrefs()
  const titleId = useId()
  const kindIds = kinds.map((kind) => kind.id)
  const entries = [
    ...kinds.map((kind) => ({ id: kind.id, label: editorLabel(kind, t) })),
    { id: PDF_TOOLS_ID, label: editorLabel({ id: PDF_TOOLS_ID }, t) },
  ]

  const onSwitch = (id: string, on: boolean) => {
    const stored = prefs.editorsOff
    const allKindsOff = kindIds.length > 0 && kindIds.every((kindId) => stored.includes(kindId))
    // Saved at once. From the all-off value (read as all on) the switch starts from all on.
    const saving = allKindsOff
      ? updateHomePrefs({ editorsOff: nextEditorsOff(stored, kindIds, id, on) })
      : setEditorOn(id, on)
    saving.catch(() => runtime?.showToast({ message: t('homeSetFailed'), tone: 'error' }))
  }

  return (
    <div className="home-set-group" role="group" aria-labelledby={titleId}>
      <div className="home-set-group-head">
        <span id={titleId} className="mobile-set-label">
          {t('homeSetEditorsTitle')}
        </span>
        <span className="home-set-desc">{t('homeSetEditorsHint')}</span>
      </div>
      {entries.map((entry) => (
        <label key={entry.id} className="mobile-set-row home-set-subrow">
          <span className="home-set-name">{entry.label}</span>
          <input
            type="checkbox"
            role="switch"
            className="mobile-switch"
            checked={isEditorOn(entry.id)}
            onChange={(e) => onSwitch(entry.id, e.target.checked)}
            data-testid={`home-set-editor-${entry.id}`}
          />
        </label>
      ))}
    </div>
  )
}
