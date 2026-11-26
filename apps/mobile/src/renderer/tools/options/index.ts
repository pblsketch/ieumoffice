/**
 * The options sheet's form, one per tool (spec 5.3, options sheet). The flow
 * (flow/Flow.tsx) owns the raw values, checks them with `checkOptions` on
 * every change and shows the error under this form; [Start] runs the tool.
 *
 * Slot for PTL-T9: replace the inside of this module with the real forms (it
 * may become index.tsx). Keep the exported names and props. Until then every
 * tool runs with its defaults (`checkOptions` fills them in), so the form
 * draws nothing.
 *
 * Rules the flow already keeps, which the forms rely on:
 * - `raw` starts as `initialToolOptions(tool)` and comes back changed only
 *   through `onChange`.
 * - `raw.passwordConfirm` (encrypt) is compared with `raw.password` on the
 *   screen only (error 'password-mismatch') and never sent to the engine.
 * - after a run, whatever its end, the flow clears `password`,
 *   `passwordConfirm` and `permissionPassword` from `raw`.
 * - blankPages has no form: its sheet is just [Find].
 */
import type { CheckedOptions } from '@genoffice/pdf-ops'
import type { PdfToolId } from '@genoffice/pdf-ops/tool-ids'
import type { ReactElement } from 'react'
import type { ToolFile } from '../engine/types'

/** Why the options cannot run: `checkOptions`' errors and the screen-only password check */
export type ToolOptionsError = Extract<CheckedOptions, { ok: false }>['error'] | 'password-mismatch'

export interface ToolOptionsFormProps {
  readonly tool: PdfToolId
  /** Pages of the first usable input (1 for pictures) */
  readonly pageCount: number
  /** The first usable input (split reads its bookmarks); read it only when needed */
  readonly input: ToolFile | null
  readonly raw: Record<string, unknown>
  onChange(raw: Record<string, unknown>): void
  /** The current error, shown by the flow under the form; null when the options run */
  readonly error: ToolOptionsError | null
}

/** The raw values a tool's sheet starts from */
export function initialToolOptions(_tool: PdfToolId): Record<string, unknown> {
  return {}
}

/** The form of `tool`'s options sheet; nothing yet (defaults) */
export function ToolOptionsForm(_props: ToolOptionsFormProps): ReactElement | null {
  return null
}
