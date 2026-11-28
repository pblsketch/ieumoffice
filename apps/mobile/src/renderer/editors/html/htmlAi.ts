// The AI tools of a mobile HTML document (spec 5.6): the desktop HTML editor's skill
// (apps/html/src/renderer/ai/html-skill.ts) over this document, with the view/edit gate. Loaded
// only when an AI run starts, so the skill and its strings stay out of the app's first load.
//
// The phone offers the tools that work on the source alone: the outline, reading the source and
// the atomic edit batch. Whole-page writing, brief cards, page measuring, pictures and the web
// need the desktop's windows and main process (`window.htmlApi`), which the phone does not have.
//
// Hidden parts are the desktop's: the model reads the desktop projection (`buildProjection`)
// where every withheld part is `{{label}}`, and its edits pass the desktop guard
// (`redact-guard.ts`) inside `apply_ops`. Both come with the desktop skill unchanged.
import type { AgentSkill, AgentToolCall, ToolExecution } from '@genoffice/agent-core'
import type { Lang } from '@genoffice/i18n'
import {
  wrapSkillWithViewEditGate,
  type DocumentEditCapabilities,
  type DocumentMode,
} from '@genoffice/mobile-bridge/view-edit-gate'
import { createDocumentSkill } from '../../../../../html/src/renderer/ai/html-skill'
import type { HtmlDocAccess } from '../../../../../html/src/renderer/ai/tools'
import {
  compileOps,
  type HtmlOp,
  type OpError,
} from '../../../../../html/src/renderer/document/ops'
import type { ParseMap } from '../../../../../html/src/renderer/document/parse-map'
import {
  sortPatches,
  type Patch,
  type PatchOrigin,
} from '../../../../../html/src/renderer/document/patch'
import { aiLangDirective, setHtmlToolLang } from './htmlAiLocale'

/** The desktop tools the phone offers; any other tool, also one the desktop adds later, is not. */
export const HTML_MOBILE_TOOLS: ReadonlySet<string> = new Set([
  'get_outline',
  'read_source',
  'apply_ops',
])

/**
 * Desktop tools the phone never offers: they need the desktop's windows or main process
 * (`window.htmlApi`: pictures, the web, page writing, print measuring).
 */
export const HTML_DESKTOP_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'generate_image',
  'plan_page',
  'write_document',
  'check_pages',
  'image_search',
  'web_search',
  'read_url',
])

/** The desktop tools that change the document (the gate's mutating set). */
export const HTML_EDIT_TOOLS: ReadonlySet<string> = new Set([
  'apply_ops',
  'plan_page',
  'write_document',
  'generate_image',
])

const MOBILE_TOOLS_NOTE =
  '\n\nOn this device only get_outline, read_source and apply_ops are available. plan_page, write_document, check_pages, image_search, generate_image, web_search and read_url are not: do not call or promise them. Edit the page with apply_ops; writing or redesigning a whole page, measuring printed pages, finding or making pictures and searching the web need the desktop app.'

/**
 * A `file://` address in what an op writes: the desktop reads such a picture through its main
 * process (`window.htmlApi.fetchImage`). The phone refuses the batch before the desktop code
 * would ask for it.
 */
const FILE_URL = /file:\/\//i

function writesFileUrl(op: unknown): boolean {
  if (typeof op !== 'object' || op === null) return false
  const fields = op as Record<string, unknown>
  const has = (value: unknown) => typeof value === 'string' && FILE_URL.test(value)
  if (has(fields.html) || has(fields.new) || has(fields.value)) return true
  const styles = fields.styles
  return typeof styles === 'object' && styles !== null && Object.values(styles).some(has)
}

/** What the HTML document lends its AI: live reads and the document's one edit path. */
export interface HtmlAiDocument {
  getText(): string
  getVersion(): number
  getMap(): ParseMap
  /** The version of the last edit that did not come from the AI. */
  getLastManualVersion(): number
  /** The element selected in the preview (edit mode), if any. */
  getSelectedSid(): number | null
  /** The document's single edit path: one patch set against the current version (one undo step). */
  applyPatches(patches: readonly Patch[], origin: PatchOrigin, label: string): boolean
}

/** Where `patches` (against one text) land in the patched text. */
function patchedRanges(patches: readonly Patch[]): Array<[number, number]> {
  let delta = 0
  return sortPatches(patches).map((p) => {
    const from = p.from + delta
    delta += p.text.length - (p.to - p.from)
    return [from, from + p.text.length] as [number, number]
  })
}

/** The document access the desktop skill reads: the required members only (spec 5.6). */
export function createMobileHtmlAccess(doc: HtmlAiDocument): HtmlDocAccess {
  return {
    getText: () => doc.getText(),
    getVersion: () => doc.getVersion(),
    getMap: () => doc.getMap(),
    getLastManualVersion: () => doc.getLastManualVersion(),
    getFilePath: () => null,
    getSelectedSid: () => doc.getSelectedSid(),
    applyOps(ops: HtmlOp[], label: string) {
      const compiled = compileOps(doc.getText(), doc.getMap(), ops)
      if (compiled.errors.length > 0) return { ok: false, errors: compiled.errors }
      if (!doc.applyPatches(compiled.patches, 'ai', label)) {
        const refused: OpError = {
          index: 0,
          kind: 'bad_args',
          message:
            'The document could not take this edit (it is read-only or changed meanwhile); read it again.',
        }
        return { ok: false, errors: [refused] }
      }
      return { ok: true, ranges: patchedRanges(compiled.patches) }
    },
    replaceAll(html: string, label: string) {
      doc.applyPatches([{ from: 0, to: doc.getText().length, text: html }], 'ai', label)
    },
  }
}

export interface MobileHtmlAiOptions {
  getMode(): DocumentMode
  getCapabilities(): DocumentEditCapabilities
  switchToEdit(): void | Promise<void>
  getLang(): Lang
  /** After a tool changed the document: the tool's summary, for the run's undo entry. */
  onMutated(summary: string): void
}

/** The desktop HTML skill for one mobile run: the phone's tools only, behind the view/edit gate. */
export function createMobileHtmlSkill(
  doc: HtmlAiDocument,
  options: MobileHtmlAiOptions,
): AgentSkill {
  setHtmlToolLang(() => options.getLang())
  // no picture making on the phone: the desktop skill hides generate_image itself as well
  const pc = createDocumentSkill(createMobileHtmlAccess(doc), () => false)
  const refuse = (call: AgentToolCall, output: string): ToolExecution => ({
    output,
    isError: true,
    summary: call.name,
  })
  const skill: AgentSkill = {
    id: pc.id,
    // the desktop adds the reply language in its panel; here the skill carries it
    get systemPrompt() {
      return pc.systemPrompt + MOBILE_TOOLS_NOTE + aiLangDirective(options.getLang())
    },
    get tools() {
      return pc.tools.filter((tool) => HTML_MOBILE_TOOLS.has(tool.name))
    },
    buildContext: () => pc.buildContext?.() ?? '',
    async executeTool(call, signal) {
      if (!HTML_MOBILE_TOOLS.has(call.name)) {
        return refuse(call, `${call.name} is not available on this device.`)
      }
      if (call.name === 'apply_ops') {
        const ops: unknown = call.input.ops
        if (Array.isArray(ops) && ops.some(writesFileUrl)) {
          return refuse(
            call,
            `0 of ${ops.length} ops applied — file:// pictures cannot be read on this device. Use an https address or a data: URL the document already has.`,
          )
        }
      }
      const result = await pc.executeTool(call, signal)
      if (result.mutated && !result.isError) options.onMutated(result.summary)
      return result
    },
  }
  return wrapSkillWithViewEditGate(skill, {
    isMutatingTool: (name) => HTML_EDIT_TOOLS.has(name),
    getMode: () => options.getMode(),
    getCapabilities: () => options.getCapabilities(),
    switchToEdit: () => options.switchToEdit(),
  })
}
