/**
 * Every AI panel (the eleven editors and the home question panel) asks the
 * person through the one shared A2UI question card. These guards read the
 * panel sources and keep the wiring the same everywhere: the shared hook and
 * its tool, the live card, the read-only card for reopened chats, restored
 * reply text, the paused elapsed time, and closing the card when a message is
 * queued or a new chat starts. They also keep the retired per-editor
 * questionnaire (`ask_clarification`) out of the HTML and slides editors.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO = fileURLToPath(new URL('../../..', import.meta.url))
const read = (path: string): string => readFileSync(join(REPO, path), 'utf8')

interface Panel {
  /** sources that together make up the panel (the sheets hook lives in App.tsx) */
  files: string[]
  /** whether a message can be queued while a run is busy */
  queues: boolean
}

const PANELS: Record<string, Panel> = {
  docs: { files: ['apps/docs/src/renderer/ai/AiPanel.tsx'], queues: true },
  sheets: {
    files: ['apps/sheets/src/renderer/App.tsx', 'apps/sheets/src/renderer/ai/AiChatPanel.tsx'],
    queues: true,
  },
  slides: { files: ['apps/slides/src/renderer/ai/AiPanel.tsx'], queues: true },
  pdf: { files: ['apps/pdf/src/renderer/ai/AiPanel.tsx'], queues: true },
  markdown: { files: ['apps/markdown/src/renderer/ai/AiPanel.tsx'], queues: true },
  html: { files: ['apps/html/src/renderer/ai/AiPanel.tsx'], queues: true },
  mindmap: { files: ['apps/mindmap/src/renderer/ai/AiPanel.tsx'], queues: true },
  hwp: { files: ['apps/hwp/src/renderer/ai/AiPanel.tsx'], queues: true },
  epub: { files: ['apps/epub/src/renderer/ai/AiPanel.tsx'], queues: true },
  diagram: { files: ['apps/diagram/src/renderer/ai/AiPanel.tsx'], queues: true },
  whiteboard: { files: ['apps/whiteboard/src/renderer/ai/AiPanel.tsx'], queues: true },
  // the home panel returns early while busy, so nothing is ever queued there
  home: { files: ['apps/shell/src/renderer/src/KbAskPanel.tsx'], queues: false },
}

const panelSource = (panel: Panel): string => panel.files.map(read).join('\n')

describe.each(Object.entries(PANELS))('%s AI panel', (_name, panel) => {
  const src = panelSource(panel)

  it('uses the shared question hook and puts its tool in the run', () => {
    expect(src).toMatch(/\buseAiInlineQuestions\b/)
    expect(src).toMatch(/\baskQuestionsSkill\b/)
  })

  it('draws the live tool card with the shared component', () => {
    expect(src).toMatch(/<AiQuestionCard\b/)
  })

  it('draws stored question calls as read-only cards when a chat is reopened', () => {
    expect(src).toMatch(/<AiQuestionReceipt\b/)
  })

  it('draws reply text through the shared body, marked restored for history', () => {
    expect(src).toMatch(/<AiAssistantBody\b/)
    expect(src).toMatch(/<AiAssistantBody\b[^>]*\brestored\b/)
  })

  it('pauses the elapsed time while a card waits', () => {
    // the shared progress line takes it as `paused`; HTML's waiting label reads it via panelWaitOf
    expect(src).toMatch(/paused=\{[^}]*\bwaitingForPerson\b|panelWaitOf\([^)]*\bwaitingForPerson\b/)
  })

  it('clears question cards when a new chat starts', () => {
    expect(src).toMatch(/\bresetConversation\b/)
  })

  it.runIf(panel.queues)('closes the waiting card when a message is queued', () => {
    expect(src).toMatch(/\bcloseOpenCard\b/)
  })
})

function sourceFiles(dir: string): string[] {
  const abs = join(REPO, dir)
  if (!existsSync(abs)) return []
  const out: string[] = []
  for (const entry of readdirSync(abs)) {
    const rel = join(dir, entry)
    if (statSync(join(REPO, rel)).isDirectory()) out.push(...sourceFiles(rel))
    else if (/\.(ts|tsx|md)$/.test(entry)) out.push(rel)
  }
  return out
}

describe('the retired per-editor questionnaire', () => {
  it.each(['apps/html/src', 'apps/slides/src'])('is gone from %s', (dir) => {
    const leftovers = sourceFiles(dir).filter((file) =>
      /\bask_clarification\b|\bClarifyCard\b|\bclarifyQuestionsToFormSpec\b/.test(read(file)),
    )
    expect(leftovers).toEqual([])
  })

  it('has no card or adapter files left', () => {
    expect(existsSync(join(REPO, 'apps/html/src/renderer/components/ClarifyCard.tsx'))).toBe(false)
    expect(existsSync(join(REPO, 'apps/slides/src/renderer/ai/question-card-adapter.ts'))).toBe(
      false,
    )
  })
})
