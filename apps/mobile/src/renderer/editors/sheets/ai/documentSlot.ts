/**
 * The spreadsheet's AI run (XLS-T11): the desktop's workbook tools with the
 * phone's limits (spec 2.6, `sheetsAgent.ts`), behind the view/edit gate.
 * Light on purpose: the tools load from their own chunk when the AI runs.
 * The AI entry points are T7's (`ai/useMobileAi.ts`) and stay hidden while AI
 * is off, which is the mobile default.
 *
 * A workbook opened with a password runs AI like any other document
 * (owner's decision): nothing here looks at `opened.unlocked`.
 */
import { wrapSkillWithViewEditGate } from '@genoffice/mobile-bridge/view-edit-gate'
import { translateMobile } from '../../../i18n'
import type { EditorAiContext, EditorAiRun } from '../../editorKind'
import type { SheetsDocumentContext } from '../workspace/slots'

export type SheetsAiRunFactory = (
  context: SheetsDocumentContext,
  ai: EditorAiContext,
) => Promise<EditorAiRun>

export const createSheetsAiRun: SheetsAiRunFactory | undefined = async (context, ai) => {
  const { host, grid } = context
  const live = grid.grid
  // the grid chunk builds the grid with the Workspace; until then there is nothing to read
  if (!live) throw new Error('The spreadsheet is not ready.')
  const { createMobileSheetsAgent } = await import('./sheetsAgent')
  const agent = createMobileSheetsAgent(live, {
    lang: () => ai.getLang(),
    onEdited: () => {
      host.markDirty(true)
      host.contentChanged()
    },
  })
  await agent.begin()
  const skill = wrapSkillWithViewEditGate(agent.skill, {
    isMutatingTool: (name) => agent.editTools.has(name),
    getMode: () => ai.getMode(),
    getCapabilities: () => ai.getCapabilities(),
    switchToEdit: () => ai.switchToEdit(),
  })
  return {
    skill,
    finish() {
      void agent.finish().then((changed) => {
        if (!changed) return
        const lang = ai.getLang()
        ai.setUndo({
          summary: translateMobile(lang, 'aiChangedPlaces', { count: changed.places }),
          undo: () => {
            ai.setUndo(null)
            void changed.undo().then(
              (outcome) => {
                if (outcome === 'reverted') return
                host.showToast({
                  message: translateMobile(
                    lang,
                    outcome === 'refused'
                      ? 'sheetsAiUndoRefused'
                      : outcome === 'partial'
                        ? 'sheetsAiUndoPartial'
                        : 'sheetsAiUndoExpired',
                  ),
                  tone: 'error',
                })
              },
              () =>
                host.showToast({
                  message: translateMobile(lang, 'sheetsAiUndoPartial'),
                  tone: 'error',
                }),
            )
          },
        })
      })
    },
  }
}
