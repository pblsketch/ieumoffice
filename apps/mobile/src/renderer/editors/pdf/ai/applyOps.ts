// What apply_ops may do on the phone (spec 3.12): a fixed list of the PC op names, notes
// only among drawings. Anything else is not executed; the reply says the phone app does
// not do that op. The ops that pass go to the PC apply_ops unchanged, which keeps its
// own rules (it still sends some of them to their dedicated tools).
import type { AgentToolDef, ToolExecution } from '@genoffice/agent-core'
import { callableOpNames, OP_DOCS } from '../../../../../../pdf/src/shared/op-docs'
import type { EditSnapshot } from '../edit/types'

/** PC op names apply_ops accepts on the phone (apps/pdf/src/shared/op-docs.ts). */
export const MOBILE_APPLY_OPS = [
  'addMarkup',
  'removeMarkup',
  'recolorMarkup',
  'deleteSavedAnnot',
  'editSavedNote',
  'setNoteContents',
  'addDrawing',
  'removeDrawing',
  'setFormValue',
  'insertBlankPage',
  'rotatePages',
  'deletePage',
  'setPageOrder',
] as const

const ALLOWED: ReadonlySet<string> = new Set(MOBILE_APPLY_OPS)

/** The model-facing reason an op is refused here (tool results are English, as on the PC). */
export const NOT_ON_MOBILE = 'an operation the mobile app does not do'

/** A pending drawing id as the model may write it (P… from read_annotations, or bare). */
const drawingId = (raw: unknown): string => {
  const id = typeof raw === 'string' ? raw.trim() : ''
  return id.startsWith('P') ? id.slice(1) : id
}

/**
 * The problems of a batch on the phone, one line per refused op; empty when every op
 * may go on to the PC tool. A malformed op is left to the PC tool's own wording.
 */
export function mobileOpProblems(raw: unknown, edits: EditSnapshot): string[] {
  if (!Array.isArray(raw)) return []
  const problems: string[] = []
  raw.forEach((item: unknown, i) => {
    if (!item || typeof item !== 'object') return
    const op = (item as { op?: unknown }).op
    if (typeof op !== 'string') return
    const bad = (why: string) => problems.push(`- ops[${i}]: "${op}" is ${why}`)
    if (!ALLOWED.has(op)) {
      bad(NOT_ON_MOBILE)
      return
    }
    if (op === 'addDrawing') {
      const drawing = (item as { drawing?: { kind?: unknown } }).drawing
      if (drawing?.kind !== 'note') bad(`${NOT_ON_MOBILE} except for notes (kind "note")`)
      return
    }
    if (op === 'removeDrawing') {
      const id = drawingId((item as { id?: unknown }).id)
      const target = edits.drawings.find((d) => d.id === id)
      if (target && target.input.kind !== 'note') {
        bad(`${NOT_ON_MOBILE} except for notes`)
      }
    }
  })
  return problems
}

/** The refusal of a batch with problems: nothing was applied, like the PC's atomic refusal. */
export function refusedBatch(problems: readonly string[], summary: string): ToolExecution {
  return {
    output: `Nothing was applied (atomic):\n${problems.join('\n')}`,
    isError: true,
    summary,
  }
}

/** The PC apply_ops definition with the phone's op reference in place of the desktop one. */
export function mobileApplyOpsTool(pc: AgentToolDef): AgentToolDef {
  const listed = callableOpNames().filter((name) => ALLOWED.has(name))
  const reference = listed
    .map((name) => `- ${name} ${OP_DOCS[name]!.aiSig ?? OP_DOCS[name]!.sig}`)
    .join('\n')
  return {
    ...pc,
    description:
      "Apply a list of canonical pending edits as ONE transaction and ONE undo step — atomic: any invalid op rejects the whole batch and nothing is applied. This is the tool for rotating, deleting and reordering pages, filling interactive form fields (call list_form_fields first), removing a pending highlight, and rewriting a pending note; a single op is a perfectly fine batch. Everything stays unsaved until the user saves. Page numbers are the document's 1-based numbers like every other tool (to rotate every page, list them all); ids are the P… ids the read tools report. Ops not listed below are not done in the mobile app.\n" +
      'Set dry_run:true to validate the batch without changing anything. A failing op returns its exact signature.\n' +
      'Op reference (? marks optional fields):\n' +
      reference,
  }
}
