import { isHidingName } from '@genoffice/agent-core/hiding-name'
import type { LazyWorkbookState, UniverRuntime } from './univer-state'

/**
 * How many sensitive-info hiding marks the workbook holds: its `IeumHide_`
 * defined names, those the engine took and those it could not install (which
 * stay in the file). A CSV copy has no defined names, so these are what it
 * would lose.
 */
export function hidingMarkCount(
  runtime: UniverRuntime | null,
  state: LazyWorkbookState | null,
): number {
  const workbook = runtime?.univerAPI.getActiveWorkbook() as unknown as
    { getDefinedNames(): Array<{ getName(): string }> } | null | undefined
  const names = new Set<string>()
  for (const defined of workbook?.getDefinedNames() ?? []) names.add(defined.getName())
  for (const name of state?.uninstalledDefinedNames ?? []) names.add(name)
  return [...names].filter(isHidingName).length
}
