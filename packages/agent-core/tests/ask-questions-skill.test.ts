/**
 * The `ask_questions` app tool in A2UI v1.0 form (spec 3.1, 3.3, 3.5, 3.6): the
 * tool definition, the card round trip and the tools-off question block guide.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  ASK_QUESTIONS_TOOL,
  ASK_QUESTIONS_TOOLS_OFF_PROMPT,
  createAskQuestionsSkill,
} from '../src/ask-questions-skill'
import {
  QUESTION_SKIP_COMPONENT_ID,
  QUESTION_SUBMIT_COMPONENT_ID,
  validateQuestionSurface,
  type QuestionCardAnswer,
  type QuestionCardRequest,
} from '../src/a2ui-question-card'
import type { AgentToolDef } from '../src/types'
import { clone, specExample, surfaceOf } from './question-card-fixtures'

const call = (input: Record<string, unknown>, id = 'c1') => ({
  id,
  name: ASK_QUESTIONS_TOOL,
  input,
})

function toolOf(): AgentToolDef {
  const skill = createAskQuestionsSkill({ ask: vi.fn() })
  expect(skill.tools).toHaveLength(1)
  return skill.tools[0]!
}

/** The first balanced JSON object in a text, starting at `from`. */
function jsonObjectAt(text: string, from: number): string {
  const start = text.indexOf('{', from)
  expect(start).toBeGreaterThanOrEqual(0)
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1)
  }
  throw new Error('no balanced JSON object')
}

/**
 * Every array in a schema has `items`, nothing Gemini's proto refuses appears,
 * and no declared property name starts with `@` (A2UI's `@path` / `@checks`
 * stay undeclared: one provider refusing such a name would fail every request).
 */
function geminiSafe(schema: unknown, path: string, problems: string[]): void {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return
  const node = schema as Record<string, unknown>
  for (const bad of ['$ref', '$defs', 'definitions', 'additionalProperties', 'const', 'oneOf']) {
    if (bad in node) problems.push(`${path}: ${bad}`)
  }
  if (Array.isArray(node.type)) problems.push(`${path}: type list`)
  if (node.type === 'array' && (typeof node.items !== 'object' || Array.isArray(node.items))) {
    problems.push(`${path}: array without one items schema`)
  }
  if (Array.isArray(node.enum) && !node.enum.every((v) => typeof v === 'string')) {
    problems.push(`${path}: non-string enum`)
  }
  if (Array.isArray(node.required)) {
    for (const key of node.required) {
      if (typeof key === 'string' && key.startsWith('@')) problems.push(`${path}: requires ${key}`)
    }
  }
  if (typeof node.properties === 'object' && node.properties !== null) {
    for (const [key, sub] of Object.entries(node.properties)) {
      if (key.startsWith('@')) problems.push(`${path}.${key}: property name starts with @`)
      geminiSafe(sub, `${path}.${key}`, problems)
    }
  }
  geminiSafe(node.items, `${path}[]`, problems)
}

describe('ask_questions tool definition', () => {
  it('keeps the tool name and takes one A2UI createSurface message', () => {
    const tool = toolOf()
    expect(tool.name).toBe('ask_questions')
    expect(tool.inputSchema.type).toBe('object')
    expect(tool.inputSchema.required).toEqual(['version', 'createSurface'])
    const properties = tool.inputSchema.properties as Record<string, Record<string, unknown>>
    expect(Object.keys(properties).sort()).toEqual(['createSurface', 'version'])
    expect(properties.createSurface!.type).toBe('object')
  })

  it('keeps the schema self-contained and inside what every provider accepts', () => {
    const tool = toolOf()
    expect(JSON.stringify(tool.inputSchema)).not.toContain('$ref')
    const problems: string[] = []
    geminiSafe(tool.inputSchema, '(schema)', problems)
    expect(problems).toEqual([])
  })

  it('says when to ask, what the app adds and how to take free text', () => {
    const { description } = toolOf()
    expect(description).toMatch(/genuinely ambiguous/)
    expect(description).toMatch(/once per run/i)
    expect(description).toMatch(/do not write buttons/i)
    expect(description).toMatch(/decide for me/i)
    expect(description).toMatch(/separate TextField/)
  })

  it('carries an example that passes the shared validator', () => {
    const { description } = toolOf()
    const marker = description.indexOf('Example:')
    expect(marker).toBeGreaterThanOrEqual(0)
    const example: unknown = JSON.parse(jsonObjectAt(description, marker))
    const checked = validateQuestionSurface(example)
    expect(checked.ok ? [] : checked.errors).toEqual([])
  })

  it('keeps the description, schema and prompt section within the 6,000-character budget', () => {
    const skill = createAskQuestionsSkill({ ask: vi.fn() })
    const tool = skill.tools[0]!
    const total =
      tool.description.length + JSON.stringify(tool.inputSchema).length + skill.systemPrompt.length
    expect(total).toBeLessThanOrEqual(6_000)
  })

  it('tells the model to ask only when direction is genuinely ambiguous, once per run', () => {
    const skill = createAskQuestionsSkill({ ask: vi.fn() })
    expect(skill.id).toBe('ask-questions')
    expect(skill.systemPrompt).toContain('`ask_questions`')
    expect(skill.systemPrompt).toMatch(/genuinely ambiguous/)
    expect(skill.systemPrompt).toMatch(/once per run/i)
    expect(skill.systemPrompt).not.toContain('<a2ui-json>')
  })
})

describe('ask_questions execution', () => {
  it('asks the card with the checked view and returns the A2UI submit action', async () => {
    let asked: QuestionCardRequest | undefined
    const ask = vi.fn(async (request: QuestionCardRequest): Promise<QuestionCardAnswer> => {
      asked = request
      return {
        kind: 'submit',
        answers: { length: 12, notes: 'Many photos' },
        decideForMe: ['audience'],
      }
    })
    const skill = createAskQuestionsSkill({ ask })
    const result = await skill.executeTool(call(specExample()))
    expect(ask).toHaveBeenCalledTimes(1)
    expect(asked?.surfaceId).toBe('deck-scope')
    expect(asked?.title).toBe('발표 자료 방향을 정해 주세요')
    expect(asked?.inputs.map((input) => input.id)).toEqual(['audience', 'length', 'notes'])
    expect(result.isError).toBe(false)
    expect(result.mutated).toBe(false)
    expect(result.summary).toBe('발표 자료 방향을 정해 주세요')
    expect(JSON.parse(result.output)).toEqual({
      version: '1.0',
      action: {
        name: 'submit',
        surfaceId: 'deck-scope',
        sourceComponentId: QUESTION_SUBMIT_COMPONENT_ID,
        timestamp: expect.any(String),
        context: { answers: { length: 12, notes: 'Many photos' }, decideForMe: ['audience'] },
      },
    })
  })

  it('returns the skip action when the person skips', async () => {
    const skill = createAskQuestionsSkill({ ask: vi.fn(async () => ({ kind: 'skip' as const })) })
    const result = await skill.executeTool(call(specExample()))
    expect(result.isError).toBe(false)
    expect(result.mutated).toBe(false)
    expect(JSON.parse(result.output)).toEqual({
      version: '1.0',
      action: {
        name: 'skip',
        surfaceId: 'deck-scope',
        sourceComponentId: QUESTION_SKIP_COMPONENT_ID,
        timestamp: expect.any(String),
        context: {},
      },
    })
  })

  it('returns the skip action when the run stops while the card waits', async () => {
    const ask = vi.fn(
      (_request: QuestionCardRequest, _signal?: AbortSignal) =>
        new Promise<QuestionCardAnswer>(() => {}),
    )
    const skill = createAskQuestionsSkill({ ask })
    const controller = new AbortController()
    const pending = skill.executeTool(call(specExample()), controller.signal)
    controller.abort()
    const result = await pending
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask.mock.calls[0]![1]).toBe(controller.signal)
    expect(JSON.parse(result.output).action.name).toBe('skip')
    expect(result.isError).toBe(false)
  })

  it('returns skip without a card when the run has already stopped', async () => {
    const ask = vi.fn()
    const skill = createAskQuestionsSkill({ ask })
    const controller = new AbortController()
    controller.abort()
    const result = await skill.executeTool(call(specExample()), controller.signal)
    expect(ask).not.toHaveBeenCalled()
    expect(JSON.parse(result.output).action.name).toBe('skip')
  })

  it('returns every format error as a line, shows no card and does not count as asked', async () => {
    const ask = vi.fn(async () => ({ kind: 'skip' as const }))
    const skill = createAskQuestionsSkill({ ask })
    const bad = clone(specExample())
    surfaceOf(bad).components = [
      { id: 'root', component: 'Column', children: ['audience'] },
      { id: 'audience', component: 'ChoicePicker', label: 'Who?', options: [], value: 'x' },
    ]
    const result = await skill.executeTool(call(bad))
    expect(result.isError).toBe(true)
    expect(ask).not.toHaveBeenCalled()
    const lines = result.output.split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(2)
    for (const line of lines) expect(line).toMatch(/^\S.*: .+/)
    expect(result.output).toContain('components[1]')

    const retried = await skill.executeTool(call(specExample(), 'c2'))
    expect(retried.isError).toBe(false)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('refuses a second card in one run until the next turn', async () => {
    const ask = vi.fn(async () => ({ kind: 'skip' as const }))
    const skill = createAskQuestionsSkill({ ask })
    await skill.executeTool(call(specExample()))
    const second = await skill.executeTool(call(specExample(), 'c2'))
    expect(second.isError).toBe(true)
    expect(JSON.parse(second.output).message).toContain('Already asked once')
    expect(ask).toHaveBeenCalledTimes(1)

    skill.resetTurn()
    const next = await skill.executeTool(call(specExample(), 'c3'))
    expect(next.isError).toBe(false)
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it('falls back to a generic summary when the card has no title', async () => {
    const skill = createAskQuestionsSkill({ ask: vi.fn(async () => ({ kind: 'skip' as const })) })
    const untitled = clone(specExample())
    const surface = surfaceOf(untitled)
    surface.components = (surface.components as Array<Record<string, unknown>>)
      .filter((component) => component.id !== 'title')
      .map((component) =>
        component.id === 'root'
          ? { ...component, children: ['audience', 'length', 'notes'] }
          : component,
      )
    const result = await skill.executeTool(call(untitled))
    expect(result.isError).toBe(false)
    expect(result.summary).toBe('Questions')
  })

  it('refuses a tool name it does not own', async () => {
    const skill = createAskQuestionsSkill({ ask: vi.fn() })
    const result = await skill.executeTool({ id: 'x', name: 'other', input: {} })
    expect(result.isError).toBe(true)
  })
})

describe('ask-questions tools-off guide', () => {
  it('is the skill prompt for runs whose model cannot call tools', () => {
    const skill = createAskQuestionsSkill({ ask: vi.fn() })
    expect(skill.toolsOffSystemPrompt).toBe(ASK_QUESTIONS_TOOLS_OFF_PROMPT)
  })

  it('describes one <a2ui-json> block at the end, only when direction is genuinely ambiguous', () => {
    const guide = ASK_QUESTIONS_TOOLS_OFF_PROMPT
    expect(guide).toMatch(/genuinely ambiguous/)
    expect(guide).toMatch(/end of (the|your) reply/i)
    expect(guide).toMatch(/one (question )?block per reply|at most one/i)
    expect(guide).toMatch(/do not write buttons/i)
    expect(guide).toMatch(/decide for me/i)
    // no tool call is possible in this run
    expect(guide).not.toContain('`ask_questions`')
  })

  it('carries an example block whose single createSurface message passes the validator', () => {
    const guide = ASK_QUESTIONS_TOOLS_OFF_PROMPT
    const open = guide.lastIndexOf('<a2ui-json>')
    const close = guide.lastIndexOf('</a2ui-json>')
    expect(open).toBeGreaterThanOrEqual(0)
    expect(close).toBeGreaterThan(open)
    const messages: unknown = JSON.parse(guide.slice(open + '<a2ui-json>'.length, close))
    expect(Array.isArray(messages)).toBe(true)
    const list = messages as unknown[]
    expect(list).toHaveLength(1)
    const checked = validateQuestionSurface(list[0])
    expect(checked.ok ? [] : checked.errors).toEqual([])
  })

  it('uses the same example as the tool description', () => {
    const { description } = toolOf()
    const fromDescription: unknown = JSON.parse(
      jsonObjectAt(description, description.indexOf('Example:')),
    )
    const guide = ASK_QUESTIONS_TOOLS_OFF_PROMPT
    const block = guide.slice(
      guide.lastIndexOf('<a2ui-json>') + '<a2ui-json>'.length,
      guide.lastIndexOf('</a2ui-json>'),
    )
    expect(JSON.parse(block)).toEqual([fromDescription])
  })
})
