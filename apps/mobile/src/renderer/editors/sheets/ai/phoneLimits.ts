/**
 * What the spreadsheet AI does not offer on the phone (spec 2.6), kept apart
 * from the AI chunk so the tests and the gate read one list.
 *
 * The desktop composes the workbook skill with the files, merge, search and
 * image skills; the phone takes the workbook skill alone, so web search, URL
 * reading, image search, image generation and attachments never exist here.
 * Inside the workbook skill the phone drops `create_document` (no new files
 * or tabs) and refuses the `propose_operations` operations a phone cannot do
 * or keeps view-only in 1판: inserting images, and editing charts, shapes,
 * sparklines, pivot tables and conditional formats (spec 3), and
 * duplicating a sheet (the phone journal blocks copy-sheet).
 */

/** Workbook tools the phone leaves out of the list the model sees. */
export const PHONE_UNAVAILABLE_TOOLS: ReadonlySet<string> = new Set(['create_document'])

/** `propose_operations` operations the phone refuses before planning. */
export const PHONE_UNAVAILABLE_OPS: ReadonlySet<string> = new Set([
  'add_image',
  'add_chart',
  'edit_chart',
  'delete_visual',
  'add_shape',
  'edit_shape',
  'add_sparkline',
  'add_pivot',
  'refresh_pivot',
  'add_conditional_format',
  'clear_conditional_formats',
  'duplicate_sheet',
])

/**
 * The workbook tools that change the document: on the desktop only
 * `propose_operations` reports `mutated: true` (tools.ts); every other tool
 * reads, or moves the selection (`select_range`) without changing data.
 * The view/edit gate switches to edit mode for these and hides them on a
 * document that cannot be changed.
 */
export const SHEETS_EDIT_TOOLS: ReadonlySet<string> = new Set(['propose_operations'])

/** Told to the model after the desktop prompt, so it does not plan what the phone refuses. */
export const PHONE_PROMPT_NOTE =
  '\n\nThis workbook is open in the phone app. Not available here: create_document, ' +
  `and these propose_operations operations: ${[...PHONE_UNAVAILABLE_OPS].join(', ')}. ` +
  'If the user asks for one of them, say it can be done in the desktop app.'

/** The model-facing refusal of a batch that carries a phone-unavailable operation. */
export function phoneUnavailableOpsError(ops: readonly { readonly op: string }[]): string | null {
  const refused = [...new Set(ops.map((op) => op.op).filter((op) => PHONE_UNAVAILABLE_OPS.has(op)))]
  if (refused.length === 0) return null
  return `Not available in the phone app: ${refused.join(', ')}. Leave these operations out (the desktop app can do them).`
}
