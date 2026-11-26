/**
 * The compact sheet switcher under the grid (spec 2.2 "시트 바꾸기"): one
 * 48 px tab per visible sheet, the active one marked by shape and
 * `aria-selected`, sliding sideways when they do not fit. In edit mode a [+]
 * adds a sheet (named `SheetN` by the desktop rule) and pressing the active
 * tab again opens its rename sheet. It stands in for Univer's mobile sheet
 * bar, whose tabs are not touch-sized and which has no add or rename.
 */
import { useEffect, useRef, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import type { DocumentMode } from '@genoffice/mobile-bridge/view-edit-gate'
import { Sheet } from '../../../components/Sheet'
import { SvgIcon } from '../../../components/icons/svgIcon'
import { translateMobile, type MobileStringKey } from '../../../i18n'
import type { UniverRuntime } from '../../../../../../sheets/src/renderer/univer-state'
import {
  activateSheet,
  addSheet,
  readSheetTabs,
  renameSheet,
  sameSheetTabs,
  sheetNameProblem,
  type SheetNameProblem,
  type SheetTabsState,
} from './sheetTabs'

const PROBLEM_KEYS: Readonly<Record<SheetNameProblem, MobileStringKey>> = {
  empty: 'sheetsSheetNameEmpty',
  invalid: 'sheetsSheetNameInvalid',
  taken: 'sheetsSheetNameTaken',
}

/** Follows the workbook's sheets (any command may add, remove, hide, rename or switch one). */
export function useSheetTabs(runtime: UniverRuntime): SheetTabsState {
  const [state, setState] = useState<SheetTabsState>(() => readSheetTabs(runtime))
  useEffect(() => {
    let frame = 0
    const refresh = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const next = readSheetTabs(runtime)
        setState((previous) => (sameSheetTabs(previous, next) ? previous : next))
      })
    }
    const api = runtime.univerAPI
    const commands = api.addEvent(api.Event.CommandExecuted, refresh)
    const switched = api.addEvent(api.Event.ActiveSheetChanged, refresh)
    // The opened file replaces the blank workbook the grid starts on.
    const created = api.addEvent(api.Event.WorkbookCreated, refresh)
    refresh()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      commands.dispose()
      switched.dispose()
      created.dispose()
    }
  }, [runtime])
  return state
}

export interface SheetSwitcherProps {
  readonly runtime: UniverRuntime
  readonly mode: DocumentMode
  readonly lang: Lang
}

export function SheetSwitcher({ runtime, mode, lang }: SheetSwitcherProps) {
  const t = (key: MobileStringKey) => translateMobile(lang, key)
  const { tabs, activeId } = useSheetTabs(runtime)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [problem, setProblem] = useState<SheetNameProblem | null>(null)
  const activeRef = useRef<HTMLButtonElement | null>(null)
  const isEdit = mode === 'edit'

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeId])

  const openRename = (id: string, name: string) => {
    setProblem(null)
    setRenaming({ id, name })
  }
  const submitRename = () => {
    if (!renaming) return
    const found = sheetNameProblem(runtime, renaming.id, renaming.name)
    if (found) {
      setProblem(found)
      return
    }
    const target = renaming
    setRenaming(null)
    void renameSheet(runtime, target.id, target.name)
  }

  if (tabs.length === 0) return null
  return (
    <div className="m-sheets-tabs" data-testid="sheets-switcher">
      <div className="m-sheets-tabs-scroll" role="tablist" aria-label={t('sheetsSheetsLabel')}>
        {tabs.map((tab) => {
          const active = tab.id === activeId
          return (
            <button
              key={tab.id}
              ref={active ? activeRef : undefined}
              type="button"
              role="tab"
              aria-selected={active}
              className="m-sheets-tab"
              onClick={() => {
                if (!active) activateSheet(runtime, tab.id)
                else if (isEdit) openRename(tab.id, tab.name)
              }}
              data-testid={`sheets-tab-${tab.id}`}
            >
              {tab.name}
            </button>
          )
        })}
      </div>
      {isEdit && (
        <button
          type="button"
          className="mobile-icon-btn m-sheets-tab-add"
          aria-label={t('sheetsAddSheet')}
          title={t('sheetsAddSheet')}
          onClick={() => void addSheet(runtime)}
          data-testid="sheets-add-sheet"
        >
          <SvgIcon size={20}>
            <path d="M12 5v14M5 12h14" />
          </SvgIcon>
        </button>
      )}
      <Sheet
        open={renaming !== null}
        title={t('sheetsRenameSheet')}
        closeLabel={t('cancel')}
        onClose={() => setRenaming(null)}
        testId="sheets-rename-sheet"
      >
        {renaming && (
          <form
            className="m-sheets-rename"
            onSubmit={(event) => {
              event.preventDefault()
              submitRename()
            }}
          >
            <label className="m-sheets-size-label" htmlFor="sheets-rename-input">
              {t('sheetsSheetName')}
            </label>
            <input
              id="sheets-rename-input"
              className="mobile-input"
              value={renaming.name}
              maxLength={31}
              aria-invalid={problem !== null}
              aria-describedby={problem ? 'sheets-rename-problem' : undefined}
              onChange={(event) => {
                setProblem(null)
                setRenaming({ ...renaming, name: event.target.value })
              }}
              data-testid="sheets-rename-input"
            />
            {problem && (
              <p id="sheets-rename-problem" className="m-sheets-rename-problem" role="alert">
                {t(PROBLEM_KEYS[problem])}
              </p>
            )}
            <button
              type="submit"
              className="mobile-touch-btn mobile-btn-primary"
              data-testid="sheets-rename-submit"
            >
              {t('sheetsRename')}
            </button>
          </form>
        )}
      </Sheet>
    </div>
  )
}
