/**
 * The options sheet's form, one per tool (spec 5.3, options sheet). The flow
 * (flow/Flow.tsx) owns the raw values, checks them with `checkOptions` on
 * every change and shows the error under the sheet; each form also draws it
 * under the field it belongs to. [Start] runs the tool.
 *
 * The forms (forms.tsx, SplitForm.tsx) write the raw keys `checkOptions`
 * reads, with the PC tools window's choices and defaults.
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
import type { CheckedOptions } from '@genoffice/pdf-ops/tool-rules'
import { DEFAULT_ANNOT_KINDS } from '@genoffice/pdf-ops/tool-rules'
import type { PdfToolId } from '@genoffice/pdf-ops/tool-ids'
import type { ToolFile } from '../engine/types'
import { SPLIT_DEFAULTS } from './split-values'

export { ToolOptionsForm } from './forms'

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

/**
 * The raw values a tool's sheet starts from: the PC tools window's defaults.
 * Split's default page range needs the page count, so its form fills it in.
 */
export function initialToolOptions(tool: PdfToolId): Record<string, unknown> {
  switch (tool) {
    case 'split':
      return { ...SPLIT_DEFAULTS }
    case 'extract':
      return { pages: '' }
    case 'rotate':
      return { rotation: 90 }
    case 'compress':
      return { compressLevel: 'medium' }
    case 'encrypt':
      return { password: '', passwordConfirm: '', restrict: false }
    case 'decrypt':
      return { password: '' }
    case 'stripAnnots':
      return { annotKinds: [...DEFAULT_ANNOT_KINDS], applyPages: '' }
    case 'imagesToPdf':
      return { imagePaper: 'A4', margin: 'small' }
    default:
      return {}
  }
}
