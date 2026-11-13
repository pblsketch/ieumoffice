// Turning AI off from Settings → Editors and AI (spec §6.2). With AI jobs
// running the screen asks first; "stop and turn off" stops every job through
// its own stop path (which ends the subscription program and its child
// processes, main side) and only then turns AI off. With none running AI
// goes off at once. Pure apart from the bridge it is handed.

import type { AppChoice, EditorChoiceApi } from '../../../shared/editor-choice'

export type AiOffApi = Pick<EditorChoiceApi, 'aiJobCount' | 'stopAllAiJobs' | 'set'>

export type AiOffStart =
  /** jobs are running: ask before anything changes */
  | { kind: 'ask'; count: number }
  /** nothing was running: AI is off now */
  | { kind: 'done'; choice: AppChoice }

/** the first step of the AI switch going off */
export async function aiOffStart(api: AiOffApi): Promise<AiOffStart> {
  const count = await api.aiJobCount().catch(() => 0)
  if (count > 0) return { kind: 'ask', count }
  return { kind: 'done', choice: await api.set({ aiFeatures: false }) }
}

/** "stop and turn off": stop every running job, then turn AI off */
export async function aiOffConfirm(api: AiOffApi): Promise<AppChoice> {
  await api.stopAllAiJobs().catch(() => 0)
  return api.set({ aiFeatures: false })
}
