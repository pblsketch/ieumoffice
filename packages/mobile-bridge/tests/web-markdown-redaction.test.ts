// Spec 4.4: hidden (withheld) text in a mobile Markdown document never reaches the model.
import { describe, expect, it, vi } from 'vitest'
import type { AgentSkill, ToolExecution } from '@genoffice/agent-core'
import {
  HIDDEN_TEXT_UNVERIFIED_MESSAGE,
  createMobileMarkdownSkill,
  hiddenSpanMarkup,
  redactedMarkdownView,
  restoreRedactedEdit,
} from '../src/markdown/index'
import type { DocumentMode } from '../src/view-edit-gate'

// The shared reader, with a switch to make it disagree with the spans found here.
const reader = vi.hoisted(() => ({ override: null as null | ((source: string) => string) }))
vi.mock('../../file-parse/src/markdown-redaction', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../file-parse/src/markdown-redaction')>()
  return {
    ...actual,
    redactMarkdownSource: (source: string) =>
      reader.override ? reader.override(source) : actual.redactMarkdownSource(source),
  }
})
const { redactMarkdownSource } = await import('../../file-parse/src/markdown-redaction')

/** The exact span the PC Markdown editor writes (apps/markdown editor/Redaction.ts). */
const pc = (label: string, words: string) =>
  `<span class="redact-span" data-redaction="" data-label="${label}">${words}</span>`

const SECRETS = ['010-1234-5678', 'HONG-GILDONG', 'ACCT-99-777', 'PW-hunter2', 'ROOM-404']

const FIXTURES: Record<string, string> = {
  list: `# 연락처\n\n- 전화: ${pc('전화', '010-1234-5678')}\n- 기타 메모\n`,
  emphasis: `**담당:** ${pc('이름', 'HONG-GILDONG')} 님, *계좌* ${pc('계좌', '*ACCT-99-777*')} 확인\n`,
  table: `| 항목 | 값 |\n|---|---|\n| 계좌 | ${pc('계좌', 'ACCT-99-777')} |\n| 암호 | ${pc('암호', 'PW-hunter2')} |\n`,
  multiple: `첫째 ${pc('가림1', 'HONG-GILDONG')}, 둘째 ${pc('가림2', 'ROOM-404')}, 셋째 ${pc('가림3', 'PW-hunter2')}.\n`,
  duplicateLabels: `A ${pc('가림1', 'ROOM-404')} 그리고 B ${pc('가림1', '010-1234-5678')}\n`,
  literalPlaceholder: `양식의 {{이름}} 칸에 ${pc('이름', 'HONG-GILDONG')}을 넣는다. {{x}} 도 그대로.\n`,
  attributesSingleQuoted: `작은따옴표 <span data-redaction data-label='전화'>010-1234-5678</span> 끝\n`,
  noLabel: `이름 없는 <span class="redact-span" data-redaction="">PW-hunter2</span> 표시\n`,
}

/** Marks the reader cannot pin down: none of these may be read at all. */
const BROKEN: Record<string, string> = {
  unclosed: `앞 <span class="redact-span" data-redaction="" data-label="x">PW-hunter2 끝까지\n`,
  rawTagInside: `앞 ${pc('x', 'PW-<b>hunter2</b>')} 뒤\n`,
  trailingBackslash: `앞 ${pc('x', 'PW-hunter2\\')} 뒤\n`,
  openCodeInside: `앞 ${pc('x', 'PW-`hunter2')} 뒤에 \` 하나\n`,
  nonPlainClose: `앞 <span class="redact-span" data-redaction="" data-label="x">PW-hunter2</span x="y"> 뒤\n`,
  tagInsideAttribute: `<a title="<span data-redaction data-label='x'>">PW-hunter2</span> 뒤\n`,
}

interface Harness {
  readonly skill: AgentSkill
  get text(): string
  set text(next: string)
  readonly mutations: Array<{ summary: string; prev: string; next: string }>
  /** Everything the model was given: prompt, context and every tool output. */
  readonly sent: string[]
  run(name: string, input?: Record<string, unknown>): Promise<ToolExecution>
  context(): string
}

function harness(initial: string, mode: DocumentMode = 'edit'): Harness {
  let text = initial
  let currentMode = mode
  const mutations: Harness['mutations'] = []
  const sent: string[] = []
  const skill = createMobileMarkdownSkill(
    {
      getMarkdown: () => text,
      setMarkdown: (next) => {
        text = next
      },
    },
    {
      getMode: () => currentMode,
      getCapabilities: () => ({ writable: true, encrypted: false, distribution: false }),
      switchToEdit: () => {
        currentMode = 'edit'
      },
      onDocumentMutated: (summary, prev, next) => mutations.push({ summary, prev, next }),
    },
  )
  sent.push(skill.systemPrompt)
  return {
    skill,
    get text() {
      return text
    },
    set text(next: string) {
      text = next
    },
    mutations,
    sent,
    async run(name, input = {}) {
      const result = await skill.executeTool({ id: `${name}-${sent.length}`, name, input })
      sent.push(result.output)
      return result
    },
    context() {
      const context = skill.buildContext?.() ?? ''
      sent.push(context, skill.systemPrompt)
      return context
    },
  }
}

const expectNoSecrets = (texts: readonly string[]) => {
  for (const out of texts) {
    for (const secret of SECRETS) expect(out).not.toContain(secret)
  }
}

describe('web markdown redaction: hidden text never reaches the model', () => {
  it.each(Object.entries(FIXTURES))(
    'context and read_document never contain the hidden words (%s)',
    async (_name, doc) => {
      const h = harness(doc, 'view')
      const context = h.context()
      const read = await h.run('read_document')
      expect(read.isError).toBeFalsy()
      expectNoSecrets(h.sent)
      // the model sees exactly what the shared reader makes of the file
      expect(read.output).toBe(redactMarkdownSource(doc))
      expect(context).toContain(redactMarkdownSource(doc))
      expect(read.output).toMatch(/\{\{[^{}]+\}\}/)
    },
  )

  it('places a {{label}} placeholder for each span, duplicates and literals kept apart', async () => {
    expect((await harness(FIXTURES.duplicateLabels!).run('read_document')).output).toBe(
      'A {{가림1}} 그리고 B {{가림1}}\n',
    )
    expect((await harness(FIXTURES.literalPlaceholder!).run('read_document')).output).toBe(
      '양식의 {{이름}} 칸에 {{이름}}을 넣는다. {{x}} 도 그대로.\n',
    )
    expect((await harness(FIXTURES.noLabel!).run('read_document')).output).toBe(
      '이름 없는 {{private}} 표시\n',
    )
  })

  it('the view equals redactMarkdownSource for PC-written fixtures', () => {
    for (const doc of Object.values(FIXTURES)) {
      expect(redactedMarkdownView(doc).text).toBe(redactMarkdownSource(doc))
    }
  })

  it('adds the placeholder instruction to the system prompt only when the document hides something', () => {
    const hidden = harness(FIXTURES.multiple!)
    expect(hidden.skill.systemPrompt).toContain('## Private placeholders')
    expect(hidden.skill.systemPrompt).toContain('- {{가림2}}')
    expect(harness('# 보통 문서\n\n숨김 없음.').skill.systemPrompt).not.toContain(
      'Private placeholders',
    )
  })

  it('a document without hidden spans is read and edited as before', async () => {
    const h = harness('# 제목\n\n{{x}} 그대로.')
    expect((await h.run('read_document')).output).toBe('# 제목\n\n{{x}} 그대로.')
    const appended = await h.run('append_markdown', { markdown: '새 {{y}} 문단' })
    expect(appended.mutated).toBe(true)
    expect(h.text).toBe('# 제목\n\n{{x}} 그대로.\n\n새 {{y}} 문단')
  })
})

describe('web markdown redaction: unverifiable marks fail closed', () => {
  it.each(Object.entries(BROKEN))(
    'refuses to create the skill for an ambiguous or broken mark (%s)',
    (_name, doc) => {
      expect(() => redactMarkdownSource(doc)).toThrow()
      expect(() =>
        createMobileMarkdownSkill(
          { getMarkdown: () => doc, setMarkdown: () => {} },
          {
            getMode: () => 'edit',
            getCapabilities: () => ({ writable: true, encrypted: false, distribution: false }),
            switchToEdit: () => {},
          },
        ),
      ).toThrow(HIDDEN_TEXT_UNVERIFIED_MESSAGE)
    },
  )

  it.each(Object.entries(BROKEN))(
    'buildContext and read_document throw and output nothing when the mark breaks during a run (%s)',
    async (_name, doc) => {
      const h = harness(FIXTURES.list!)
      h.text = doc
      let context: string | undefined
      expect(() => {
        context = h.skill.buildContext?.()
      }).toThrow(HIDDEN_TEXT_UNVERIFIED_MESSAGE)
      expect(context).toBeUndefined()
      await expect(
        Promise.resolve().then(() =>
          h.skill.executeTool({ id: 'r', name: 'read_document', input: {} }),
        ),
      ).rejects.toThrow(HIDDEN_TEXT_UNVERIFIED_MESSAGE)
      for (const name of ['replace_text', 'append_markdown', 'replace_document']) {
        await expect(
          Promise.resolve().then(() =>
            h.skill.executeTool({
              id: name,
              name,
              input: { find: '앞', replace: 'X', markdown: 'X' },
            }),
          ),
        ).rejects.toThrow(HIDDEN_TEXT_UNVERIFIED_MESSAGE)
      }
      expect(h.text).toBe(doc)
      expect(h.mutations).toEqual([])
      // the prompt carries no instruction (and no text) for an unverifiable document
      expect(h.skill.systemPrompt).not.toContain('PW-hunter2')
      expect(h.skill.systemPrompt).not.toContain('Private placeholders')
    },
  )

  it('refuses a view that does not equal what redactMarkdownSource reads', async () => {
    const h = harness(FIXTURES.multiple!)
    reader.override = (source) => source.replace(/<span[^>]*>/g, '').replace(/<\/span>/g, '')
    try {
      expect(() => h.skill.buildContext?.()).toThrow(HIDDEN_TEXT_UNVERIFIED_MESSAGE)
      await expect(
        Promise.resolve().then(() =>
          h.skill.executeTool({ id: 'r', name: 'read_document', input: {} }),
        ),
      ).rejects.toThrow(HIDDEN_TEXT_UNVERIFIED_MESSAGE)
      expect(() => redactedMarkdownView(FIXTURES.multiple!)).toThrow(HIDDEN_TEXT_UNVERIFIED_MESSAGE)
    } finally {
      reader.override = null
    }
  })

  it('the thrown error carries no document text', () => {
    try {
      redactedMarkdownView(BROKEN.unclosed!)
      expect.unreachable()
    } catch (err) {
      expect((err as Error).message).toBe(HIDDEN_TEXT_UNVERIFIED_MESSAGE)
      expectNoSecrets([(err as Error).message, String((err as Error).stack ?? '')])
    }
  })
})

describe('web markdown redaction: model edits map back to the original spans', () => {
  const DOC = `# 메모\n\n${pc('가림1', 'HONG-GILDONG')} 님께 ${pc('가림2', '010-1234-5678')}로 연락. 양식 {{x}}.\n`
  const REFUSED = (token: string) => `Hidden placeholder ${token} cannot be changed or removed.`

  const refusedCases: Array<[string, string, Record<string, unknown>, string]> = [
    [
      'drops a placeholder (replace_text)',
      'replace_text',
      { find: '{{가림2}}로 ', replace: '' },
      '{{가림2}}',
    ],
    [
      'drops a placeholder (replace_document)',
      'replace_document',
      { markdown: '# 메모\n\n{{가림1}} 님께 연락. 양식 {{x}}.\n' },
      '{{가림2}}',
    ],
    [
      'adds a placeholder (append_markdown)',
      'append_markdown',
      { markdown: '추가 {{가림1}}' },
      '{{가림1}}',
    ],
    [
      'adds a literal-looking placeholder (append_markdown)',
      'append_markdown',
      { markdown: '새 칸 {{y}}' },
      '{{가림1}}',
    ],
    [
      'reorders placeholders',
      'replace_document',
      { markdown: '# 메모\n\n{{가림2}} 님께 {{가림1}}로 연락. 양식 {{x}}.\n' },
      '{{가림1}}',
    ],
    [
      'splits a placeholder',
      'replace_text',
      { find: '{{가림1}}', replace: '{{가림}}1}}' },
      '{{가림1}}',
    ],
    [
      'breaks a placeholder open',
      'replace_text',
      { find: '{{가림2}}', replace: '{{가림2}' },
      '{{가림2}}',
    ],
    [
      'renames a placeholder',
      'replace_text',
      { find: '{{가림1}}', replace: '{{고객}}' },
      '{{가림1}}',
    ],
    [
      'changes the literal {{x}} text',
      'replace_text',
      { find: '{{x}}', replace: '{{z}}' },
      '{{가림1}}',
    ],
    [
      'adds span markup of its own',
      'append_markdown',
      { markdown: pc('새것', 'made up') },
      '{{가림1}}',
    ],
  ]

  it.each(refusedCases)(
    'rejects an edit that %s, leaving the document unchanged',
    async (_n, tool, input, token) => {
      const h = harness(DOC)
      const result = await h.run(tool, input)
      expect(result.isError).toBe(true)
      expect(result.mutated).toBeFalsy()
      expect(result.output).toContain(REFUSED(token))
      expect(h.text).toBe(DOC)
      expect(h.mutations).toEqual([])
      expectNoSecrets(h.sent)
    },
  )

  it('rejects an edit whose result could no longer be read back the same way', async () => {
    // a backtick inside the hidden words is harmless until the model adds one after the span
    const doc = `앞 ${pc('가림1', 'PW-`hunter2')} 뒤\n`
    const h = harness(doc)
    const result = await h.run('replace_text', { find: '뒤', replace: '뒤 `코드`' })
    expect(result.isError).toBe(true)
    expect(result.output).toContain(REFUSED('{{가림1}}'))
    expect(h.text).toBe(doc)
  })

  it('an intact replace_text restores the original span source exactly', async () => {
    const h = harness(DOC)
    const result = await h.run('replace_text', { find: '연락', replace: '전화 연락' })
    expect(result.mutated).toBe(true)
    expect(h.text).toBe(DOC.replace('연락', '전화 연락'))
    expect(h.text).toContain(pc('가림1', 'HONG-GILDONG'))
    expect(h.text).toContain(pc('가림2', '010-1234-5678'))
    expect(h.mutations).toEqual([
      { summary: 'Replaced "연락"', prev: DOC, next: DOC.replace('연락', '전화 연락') },
    ])
    expectNoSecrets(h.sent)
  })

  it('an intact replace_document keeps literal {{x}} text and restores each hidden span in order', async () => {
    const h = harness(DOC)
    const result = await h.run('replace_document', {
      markdown: '# 새 메모\n\n- 받는 분: {{가림1}}\n- 번호: {{가림2}}\n\n양식 칸 {{x}} 유지.\n',
    })
    expect(result.mutated).toBe(true)
    expect(h.text).toBe(
      `# 새 메모\n\n- 받는 분: ${pc('가림1', 'HONG-GILDONG')}\n- 번호: ${pc('가림2', '010-1234-5678')}\n\n양식 칸 {{x}} 유지.\n`,
    )
    expect(redactedMarkdownView(h.text).text).toBe(
      '# 새 메모\n\n- 받는 분: {{가림1}}\n- 번호: {{가림2}}\n\n양식 칸 {{x}} 유지.\n',
    )
  })

  it('duplicate labels map back by position, not by name', async () => {
    const doc = FIXTURES.duplicateLabels!
    const h = harness(doc)
    const result = await h.run('replace_text', { find: '그리고', replace: '및' })
    expect(result.mutated).toBe(true)
    expect(h.text).toBe(doc.replace('그리고', '및'))
    expect(h.text.indexOf('ROOM-404')).toBeLessThan(h.text.indexOf('010-1234-5678'))
  })

  it('an intact append keeps every span', async () => {
    const h = harness(DOC)
    const result = await h.run('append_markdown', { markdown: '## 끝\n\n맺음말.' })
    expect(result.mutated).toBe(true)
    expect(h.text).toBe(`${DOC}## 끝\n\n맺음말.`)
  })

  it('replace_text finds its text in the view, not in the hidden words', async () => {
    const h = harness(DOC)
    const result = await h.run('replace_text', { find: 'HONG-GILDONG', replace: '누구' })
    expect(result.isError).toBe(true)
    expect(result.output).toBe('Text not found: HONG-GILDONG')
    expect(h.text).toBe(DOC)
  })

  it('a "$&" in the replacement stays literal', async () => {
    const h = harness(DOC)
    await h.run('replace_text', { find: '양식', replace: '$& 서식' })
    expect(h.text).toBe(DOC.replace('양식', () => '$& 서식'))
  })

  it('relative image links survive an edit of a document with hidden spans', async () => {
    const doc = `![그림](images/a.png "제목")\n\n${pc('가림1', 'HONG-GILDONG')}\n`
    const h = harness(doc)
    const result = await h.run('replace_document', {
      markdown: '# 머리\n\n![그림](images/a.png "제목")\n\n{{가림1}}\n',
    })
    expect(result.mutated).toBe(true)
    expect(h.text).toBe(
      `# 머리\n\n![그림](images/a.png "제목")\n\n${pc('가림1', 'HONG-GILDONG')}\n`,
    )
  })

  it('restoreRedactedEdit rejects and accepts on the view alone', () => {
    const view = redactedMarkdownView(DOC)
    expect(restoreRedactedEdit(view, view.text)).toEqual({ ok: true, source: DOC })
    const dropped = restoreRedactedEdit(view, view.text.replace('{{가림1}}', ''))
    expect(dropped.ok).toBe(false)
  })

  it('hiddenSpanMarkup writes the PC form', () => {
    expect(hiddenSpanMarkup('가림1', '비밀')).toBe(pc('가림1', '비밀'))
  })
})
