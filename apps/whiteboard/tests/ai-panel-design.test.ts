import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../src/renderer/ai', import.meta.url))
const readAiFile = (name: string): string => readFileSync(join(ROOT, name), 'utf8')

describe('Whiteboard AI panel shared design system alignment', () => {
  it('loads shared @genoffice/ui AI stylesheets in the expected override order', () => {
    const dock = readAiFile('AiDock.tsx')
    const queueIdx = dock.indexOf("import '@genoffice/ui/ai-queue-strip.css'")
    const localIdx = dock.indexOf("import './ai-panel.css'")
    const sharedIdx = dock.indexOf("import '@genoffice/ui/ai-panel.css'")
    expect(queueIdx).toBeGreaterThan(-1)
    expect(localIdx).toBeGreaterThan(-1)
    expect(sharedIdx).toBeGreaterThan(localIdx)
    expect(dock).toContain('ai-rail ai-entry')
    expect(dock).toContain("aiSubscriptionText(lang, 'aiAssistant')")
  })

  it('uses shared design tokens and panel chrome classes in ai-panel.css', () => {
    const css = readAiFile('ai-panel.css')
    expect(css).toContain('background: var(--color-bg-page);')
    expect(css).not.toMatch(/var\(--bg\)/)
    expect(css).not.toMatch(/\.wbai-/)
    expect(css).toContain("html:not([data-ai-panel-side='right']) .wb-app > .ai-dock")
    expect(css).toContain('.ai-panel-resizer')
    expect(css).toContain('.ai-chat-empty')
    expect(css).toContain('.ai-attachments')
  })

  it('uses shared AI panel components and class hooks in AiPanel.tsx', () => {
    const panel = readAiFile('AiPanel.tsx')
    expect(panel).not.toMatch(/\bwbai-/)
    expect(panel).not.toContain('className="wb-btn"')
    expect(panel).toContain('className="ai-panel-resizer"')
    expect(panel).toContain("aria-label={aiSubscriptionText(lang, 'aiAssistant')}")
    expect(panel).toContain('<AiPanelHeader')
    expect(panel).toContain('className="ai-header-btn ai-panel-collapse"')
    expect(panel).toContain('className="ai-chat"')
    expect(panel).toContain('className="ai-chat-empty"')
    expect(panel).toContain('className="ai-chat-empty-badge"')
    expect(panel).toContain('className="ai-starter-list"')
    expect(panel).toContain('<AiEmptyHints')
    expect(panel).toContain('<AiReplyProgress')
    expect(panel).toContain('<AiReplyFooter')
    expect(panel).toContain('<AiScrollToBottom')
    expect(panel).toContain('<AiQueueStrip')
    expect(panel).toContain('<AiToolsUnsupportedNotice')
    expect(panel).toContain('<AiUsageChip')
    expect(panel).toContain('useProjectPanel')
    expect(panel).toContain('<AiFirstConnectionNotice')
    expect(panel).toMatch(/<AiFirstConnectionNotice[\s\S]*?\bcodexKeepsHistory\b/)
    expect(panel).toContain('<AiChangesCard')
  })

  it('wires the question card: kept input and output, read-only cards when reopened, paused time', () => {
    const panel = readAiFile('AiPanel.tsx')
    // the live card is the shared one, keyed per card
    expect(panel).toMatch(/<AiQuestionCard\s+key=\{inlineQuestions\.activeToolCard\.id\}/)
    expect(panel).toContain('view={inlineQuestions.activeToolCard.view}')
    // a question call keeps its input and output, live and when read back from a saved chat
    expect(panel).toMatch(/\.\.\.keptToolActivity\(\{[\s\S]*?input: call\.input,[\s\S]*?\}\)/)
    expect(panel).toContain('tools: entry.tools.map(keptToolActivity)')
    expect(panel).toContain('QUESTION_TOOL_FIELD_MAX_CHARS = 16_000')
    // a reopened chat draws its question calls and question blocks read-only
    expect(panel).toMatch(/function chatEntryOf[\s\S]*?restored: true/)
    expect(panel).toContain('<AiQuestionReceipt')
    expect(panel).toContain('restored={entry.restored}')
    // the elapsed time holds while the card waits
    expect(panel).toContain('paused={inlineQuestions.waitingForPerson}')
  })
})

/** the source of one function of a panel, from its opening line to its closing brace */
function panelSection(file: string, start: string, end = '\n  }\n'): string {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const at = src.indexOf(start)
  if (at < 0) throw new Error(`${start} not found in ${file}`)
  return src.slice(at, src.indexOf(end, at))
}

describe('whiteboard AI panel: question cards follow the conversation (a2ui spec 4)', () => {
  it('a message queued while a card waits closes it without a second card in that run', () => {
    const queue = panelSection('../src/renderer/ai/AiPanel.tsx', 'const enqueueDraft = ')
    expect(queue).toContain('inlineQuestions.closeOpenCard()')
    expect(queue).not.toContain('supersedeOpen')
  })

  it('new chat and an opened chat drop the cards and reset the one-card limit', () => {
    expect(panelSection('../src/renderer/ai/AiPanel.tsx', 'const resetConversation = ')).toContain(
      'inlineQuestions.resetConversation()',
    )
  })
})
