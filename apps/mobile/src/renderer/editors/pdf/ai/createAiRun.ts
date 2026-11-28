// The PDF kind's AI run (spec 3.12). This file stays light: the PC tools, their labels
// in 22 languages and the mobile wiring (./pdfAgent) load only when the AI runs, the
// way the HWP editor loads ai/hwpAgent.ts. AI is off by default; with it off App never
// calls this and the shell shows no AI entry.
import { wrapSkillWithViewEditGate } from '@genoffice/mobile-bridge/view-edit-gate'
import { translateMobile } from '../../../i18n/strings'
import type { EditorAiContext, EditorAiRun, EditorHost } from '../../editorKind'
import type { PdfEditSession } from '../edit/editSession'
import type { FormMarkPainter } from '../features/form/formModel'
import type { PdfKeptView, PdfViewerHandle } from '../view'

/** What the AI tools reach of one open PDF. */
export interface PdfAiEnv {
  readonly host: EditorHost
  readonly editSession: PdfEditSession
  /** The mounted viewer (scrolling to a page), null while no Workspace is mounted. */
  readonly viewer: () => PdfViewerHandle | null
  /** Where the reader is when no viewer is mounted. */
  readonly keptView: PdfKeptView
  /** The check/cross painter of add_form_mark; default the PC painter. */
  readonly paintMark?: FormMarkPainter
}

export async function createPdfAiRun(env: PdfAiEnv, ctx: EditorAiContext): Promise<EditorAiRun> {
  const { createMobilePdfAgent } = await import('./pdfAgent')
  const agent = createMobilePdfAgent(env, () => ctx.getLang())
  await agent.begin()
  const skill = wrapSkillWithViewEditGate(agent.skill, {
    isMutatingTool: (name) => agent.editTools.has(name),
    getMode: () => ctx.getMode(),
    getCapabilities: () => ctx.getCapabilities(),
    switchToEdit: () => ctx.switchToEdit(),
  })
  return {
    skill,
    finish() {
      const changed = agent.finish()
      if (!changed) return
      // one run is one change card: taken back at once, unless the document changed since
      ctx.setUndo({
        summary: translateMobile(ctx.getLang(), 'aiChangedPlaces', { count: changed.places }),
        undo: () => {
          ctx.setUndo(null)
          if (changed.undo() !== 'reverted') {
            env.host.showToast({
              message: translateMobile(ctx.getLang(), 'aiUndoRefused'),
              tone: 'error',
            })
          }
        },
      })
    },
  }
}
