import {
  QUESTION_CARD_CATALOG_ID,
  questionAnswerAction,
  validateQuestionSurface,
  type QuestionCardAnswer,
  type QuestionCardRequest,
} from './a2ui-question-card'
import type { AgentSkill } from './skill'
import type { AgentToolCall, AgentToolDef, ToolExecution } from './types'

/**
 * Shared in-loop app tool (`ask_questions`) that lets the AI present a compact
 * inline question card without enabling any external subscription CLI tools.
 * The input is one A2UI v1.0 `createSurface` message and the output one A2UI
 * `action` message (see `a2ui-question-card.ts`). At most one card per run.
 */
export const ASK_QUESTIONS_TOOL = 'ask_questions'

export interface AskQuestionsDeps {
  /**
   * Renders the inline question card for the checked view and resolves when
   * the person submits or skips. `signal` aborts when the run stops; the tool
   * then answers `skip` without waiting for this promise.
   */
  readonly ask: (request: QuestionCardRequest, signal?: AbortSignal) => Promise<QuestionCardAnswer>
}

/** `summary` of a card without a title. */
const UNTITLED_SUMMARY = 'Questions'

/** The one example the tool description and the tools-off guide share. */
const EXAMPLE = JSON.stringify({
  version: '1.0',
  createSurface: {
    surfaceId: 'deck-scope',
    catalogId: QUESTION_CARD_CATALOG_ID,
    components: [
      { id: 'root', component: 'Column', children: ['title', 'audience', 'length', 'notes'] },
      { id: 'title', component: 'Text', text: 'Choose the deck direction' },
      {
        id: 'audience',
        component: 'ChoicePicker',
        label: 'Who is it for?',
        variant: 'mutuallyExclusive',
        options: [
          { label: 'Parents', value: 'parents' },
          { label: 'Colleagues', value: 'colleagues' },
        ],
        value: { '@path': '/audience' },
        '@checks': [
          { condition: { '@call': 'required', args: { value: { '@path': '/audience' } } } },
        ],
      },
      {
        id: 'length',
        component: 'Slider',
        label: 'Slides',
        min: 5,
        max: 20,
        value: { '@path': '/length' },
      },
      {
        id: 'notes',
        component: 'TextField',
        label: 'Anything else?',
        variant: 'longText',
        value: { '@path': '/notes' },
      },
    ],
    dataModel: { audience: [], length: 10, notes: '' },
  },
})

/** The card format, shared by the tool description and the tools-off guide. */
const FORMAT_RULE_LINES = [
  `One A2UI v1.0 createSurface message (catalogId "${QUESTION_CARD_CATALOG_ID}"). components is a flat list: a Column with id "root" whose children list every other component id once, in screen order. Leading Text components are the card title, then its description; a Text right before an input describes that input.`,
  '1-5 inputs: ChoicePicker (options: 1-7 {label, value}; variant mutuallyExclusive or multipleSelection), CheckBox (one yes/no), TextField (variant shortText, longText or number; optional placeholder), Slider (min, max, optional integer steps). Every input needs a label and value {"@path":"/<its id>"}. Starting values go in dataModel keyed by input id (ChoicePicker: a list of option values). A must-answer input gets "@checks":[{"condition":{"@call":"required","args":{"value":{"@path":"/<its id>"}}}}]. Ids must not start with "ieum_". All text is plain text in the reply language.',
  'The app adds the Send and Skip buttons and a "decide for me" choice to every ChoicePicker; do not write buttons. There is no "other" option: for free-text answers add a separate TextField.',
]

const WHEN_TO_ASK =
  'Ask only when a purpose-built creation skill calls for scoping or when the direction (audience, length, tone, format) is genuinely ambiguous; if the request already says enough, proceed without asking. At most once per run.'

const TOOL_DEF: AgentToolDef = {
  name: ASK_QUESTIONS_TOOL,
  description: [
    'Show the person an inline question card and wait for the answers. This card is the only way to ask the person something: never ask in plain reply text.',
    WHEN_TO_ASK,
    'Ask everything the work needs in this one card, the subject too (a required TextField) when the request names none; after the answers, do the work without asking again.',
    `Input: ${FORMAT_RULE_LINES.join('\n')}`,
    'Result: an A2UI action message. "submit" carries context.answers (input id -> value) and context.decideForMe (ids left for you to choose); "skip" means choose sensible defaults yourself. An invalid card returns "<location>: <reason>" lines instead; fix them and call again.',
    `Example: ${EXAMPLE}`,
  ].join('\n'),
  // Deliberately loose: every provider (Gemini's schema converter included)
  // must accept it, and validateQuestionSurface does the deep check.
  inputSchema: {
    type: 'object',
    properties: {
      version: { type: 'string', enum: ['1.0'] },
      createSurface: {
        type: 'object',
        properties: {
          surfaceId: { type: 'string' },
          catalogId: { type: 'string', enum: [QUESTION_CARD_CATALOG_ID] },
          components: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                component: {
                  type: 'string',
                  enum: ['Column', 'Text', 'ChoicePicker', 'CheckBox', 'TextField', 'Slider'],
                },
                children: { type: 'array', items: { type: 'string' } },
                text: { type: 'string' },
                label: { type: 'string' },
                variant: { type: 'string' },
                options: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { label: { type: 'string' }, value: { type: 'string' } },
                    required: ['label', 'value'],
                  },
                },
                // left loose: a property name starting with "@" is not declared
                // anywhere, since one provider refusing it would fail every request
                value: { type: 'object' },
                placeholder: { type: 'string' },
                min: { type: 'number' },
                max: { type: 'number' },
                steps: { type: 'integer' },
              },
              required: ['id', 'component'],
            },
          },
          dataModel: { type: 'object', description: 'Starting values keyed by input id.' },
        },
        required: ['surfaceId', 'components'],
      },
    },
    required: ['version', 'createSurface'],
  },
}

const SYSTEM_PROMPT = [
  '## Clarifying questions (`ask_questions`)',
  '- Call `ask_questions` ONLY when using a purpose-built creation skill or when key direction (audience, length, tone, format) is genuinely ambiguous.',
  '- If the person already gave enough detail, proceed immediately without asking.',
  '- Ask at most ONCE per run, with 1-5 short questions and sensible starting values.',
  '- Every question for the person goes into this card. Never ask in the text of your reply while this tool is available.',
  '- Put everything the work needs into that one card, including the subject itself (a required TextField) when the request names none.',
  '- After the answers, continue the work right away: choose yourself for ids in decideForMe, for anything still open, or when the card was skipped, and say in your reply what you assumed. Do not ask again.',
].join('\n')

/**
 * The skill's prompt section for a run whose model cannot call tools (spec
 * 3.5): the same card written as an A2UI Direct JSON block in the reply.
 */
export const ASK_QUESTIONS_TOOLS_OFF_PROMPT = [
  '## Clarifying questions (question block)',
  '- Only when key direction (audience, length, tone, format) is genuinely ambiguous, you may ask instead of guessing: put one question block at the end of your reply. If the person already gave enough detail, just answer.',
  '- The block is <a2ui-json>, then a JSON array holding exactly one A2UI createSurface message, then </a2ui-json>. At most one block per reply.',
  ...FORMAT_RULE_LINES.map((line) => `- ${line}`),
  "- The person's answers arrive as their next message.",
  `- Example: <a2ui-json>[${EXAMPLE}]</a2ui-json>`,
].join('\n')

const SKIP: QuestionCardAnswer = { kind: 'skip' }

/** The card's answer, or skip as soon as the run stops (the card may never settle). */
function askOrSkip(
  deps: AskQuestionsDeps,
  request: QuestionCardRequest,
  signal: AbortSignal | undefined,
): Promise<QuestionCardAnswer> {
  if (!signal) return deps.ask(request)
  if (signal.aborted) return Promise.resolve(SKIP)
  return new Promise<QuestionCardAnswer>((resolve, reject) => {
    const onAbort = () => resolve(SKIP)
    signal.addEventListener('abort', onAbort, { once: true })
    deps.ask(request, signal).then(
      (answer) => {
        signal.removeEventListener('abort', onAbort)
        resolve(signal.aborted ? SKIP : answer)
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort)
        if (signal.aborted) resolve(SKIP)
        else reject(err instanceof Error ? err : new Error(String(err)))
      },
    )
  })
}

export interface AskQuestionsSkill extends AgentSkill {
  /** Resets the per-run 1-card limit when a new user turn begins. */
  resetTurn(): void
}

export function createAskQuestionsSkill(deps: AskQuestionsDeps): AskQuestionsSkill {
  let askedInRun = false
  return {
    id: 'ask-questions',
    systemPrompt: SYSTEM_PROMPT,
    toolsOffSystemPrompt: ASK_QUESTIONS_TOOLS_OFF_PROMPT,
    tools: [TOOL_DEF],
    resetTurn() {
      askedInRun = false
    },
    async executeTool(call: AgentToolCall, signal?: AbortSignal): Promise<ToolExecution> {
      if (call.name !== ASK_QUESTIONS_TOOL) {
        return { output: `Unknown tool: ${call.name}`, isError: true, summary: call.name }
      }
      if (askedInRun) {
        return {
          output: JSON.stringify({
            ok: false,
            message: 'Already asked once in this turn; proceed with reasonable defaults',
          }),
          isError: true,
          summary: 'Ask skipped (already asked)',
        }
      }
      // a format error shows no card and does not use up this run's one card
      const checked = validateQuestionSurface(call.input)
      if (!checked.ok) {
        return {
          output: checked.errors.join('\n'),
          isError: true,
          summary: 'Invalid question card',
        }
      }
      askedInRun = true
      const answer = await askOrSkip(deps, checked.view, signal)
      return {
        output: JSON.stringify(questionAnswerAction(checked.view, answer, Date.now())),
        isError: false,
        mutated: false,
        summary: checked.view.title ?? UNTITLED_SUMMARY,
      }
    },
  }
}
