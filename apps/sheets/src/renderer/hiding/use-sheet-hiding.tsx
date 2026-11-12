/**
 * The person's side of sensitive-info hiding in the spreadsheet editor: the
 * "Hide sensitive info" / "Stop hiding" entries of the cell and header menus
 * and the label dialog they open. App.tsx forwards the two menu commands here
 * and renders `element`.
 */
import React, { useRef, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import { parseHidingName } from '@genoffice/agent-core/hiding-name'
import { SensitiveLabelDialog } from '@genoffice/ui'
import { columnLabel } from '@genoffice/xlsx-gateway/domain/cell-address'
import type { CellScalar } from '@genoffice/xlsx-gateway/domain/workbook.types'
import { t } from '../i18n/locale'
import type { UniverRuntime } from '../univer-state'
import {
  createHidingMark,
  hideTargetOf,
  removeHiding,
  selectedAreas,
  type HideTarget,
} from './actions'
import { HIDING_MAX_ROW, type HidingArea } from './marks'

export const SENSITIVE_HIDE_COMMAND = 'sensitive-hide'
export const SENSITIVE_UNHIDE_COMMAND = 'sensitive-unhide'

/** "B2:B", "C3:D9" — how the status line names an area */
export function areaText(area: HidingArea): string {
  const from = `${columnLabel(area.startColumn)}${area.startRow + 1}`
  const to =
    area.endRow >= HIDING_MAX_ROW
      ? columnLabel(area.endColumn)
      : `${columnLabel(area.endColumn)}${area.endRow + 1}`
  return from === to ? from : `${from}:${to}`
}

export interface SheetHidingUiArgs {
  readonly univerRef: { readonly current: UniverRuntime | null }
  readonly lang: Lang
  readonly setMessage: (message: string) => void
  /** a column's top cells (row 0 first), loaded if the workbook streams */
  readonly readColumn: (
    sheetId: string,
    column: number,
  ) => Promise<readonly (CellScalar | undefined)[]>
}

export interface SheetHidingUi {
  /** runs a menu command; false when the command is not one of these */
  readonly command: (command: string) => boolean
  /** the label dialog while it is open */
  readonly element: React.JSX.Element | null
  /** hide areas under a label (the candidate list's confirm uses this too) */
  readonly hide: (areas: readonly HidingArea[], label: string) => string | null
}

export function useSheetHiding(args: SheetHidingUiArgs): SheetHidingUi {
  const [pending, setPending] = useState<HideTarget | null>(null)
  const argsRef = useRef(args)
  argsRef.current = args

  const hide = (areas: readonly HidingArea[], label: string): string | null => {
    const { univerRef, lang, setMessage } = argsRef.current
    const runtime = univerRef.current
    if (!runtime) return null
    const name = createHidingMark(runtime, areas, label, lang)
    if (name) {
      setMessage(
        t('appSensitiveHidden', {
          range: areas.map(areaText).join(', '),
          marker: `{{${parseHidingName(name)?.label ?? label}}}`,
        }),
      )
    }
    return name
  }

  const command = (command: string): boolean => {
    const { univerRef, setMessage, readColumn } = argsRef.current
    if (command === SENSITIVE_HIDE_COMMAND) {
      const selection = selectedAreas(univerRef.current)
      void hideTargetOf(selection, readColumn).then((target) => {
        if (target && target.areas.length > 0) setPending(target)
      })
      return true
    }
    if (command === SENSITIVE_UNHIDE_COMMAND) {
      const runtime = univerRef.current
      if (!runtime) return true
      const selection = selectedAreas(runtime).map((entry) => entry.area)
      const changed = removeHiding(runtime, selection)
      setMessage(
        changed > 0
          ? t('appSensitiveUnhidden', { range: selection.map(areaText).join(', ') })
          : t('appSensitiveNothingHidden'),
      )
      return true
    }
    return false
  }

  const element = pending ? (
    <SensitiveLabelDialog
      lang={args.lang}
      seed={pending.seed}
      onCancel={() => setPending(null)}
      onSubmit={(label) => {
        const target = pending
        setPending(null)
        hide(target.areas, label)
      }}
    />
  ) : null

  return { command, element, hide }
}
