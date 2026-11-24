/**
 * The AI question card contract in A2UI v1.0 (https://github.com/a2ui-project/a2ui).
 *
 * The `ask_questions` tool input is one A2UI `createSurface` message drawn with
 * the catalog `ieumoffice.com:question-card/v1` (a subset of the A2UI Basic
 * Catalog v1, see `question-card-catalog.json`). This module checks such a
 * message, turns it into the fixed view the app's card draws, and builds the
 * A2UI `action` message the card returns as the tool output. The tool, the card,
 * the in-text block and the reopened-chat reader all use this one set.
 *
 * Pure and dependency-free; nothing here throws.
 */

/** The catalog id stored in chats; never change it (a new catalog gets `/v2`). */
export const QUESTION_CARD_CATALOG_ID = 'ieumoffice.com:question-card/v1'
/** The A2UI protocol version of every message here. */
export const A2UI_PROTOCOL_VERSION = '1.0'
/** Input components per card (adjustable). */
export const QUESTION_CARD_MAX_INPUTS = 5
/** Options per ChoicePicker (adjustable). */
export const QUESTION_CARD_MAX_OPTIONS = 7
/** Error lines returned for one invalid message. */
export const QUESTION_CARD_MAX_ERRORS = 10
/** Component ids starting with this are reserved for the app's own buttons. */
export const QUESTION_CARD_RESERVED_ID_PREFIX = 'ieum_'
/** `sourceComponentId` of the app's submit button (not in the component list). */
export const QUESTION_SUBMIT_COMPONENT_ID = 'ieum_submit'
/** `sourceComponentId` of the app's skip button (not in the component list). */
export const QUESTION_SKIP_COMPONENT_ID = 'ieum_skip'
/** `action.name` when the person submits. */
export const QUESTION_SUBMIT_ACTION = 'submit'
/** `action.name` when the card is skipped, stopped or closed by a new message. */
export const QUESTION_SKIP_ACTION = 'skip'

export type QuestionInputKind = 'ChoicePicker' | 'CheckBox' | 'TextField' | 'Slider'
export type QuestionComponentName = 'Column' | 'Text' | QuestionInputKind

/**
 * Properties each component accepts (besides `id` and `component`): exactly the
 * properties the A2UI Basic Catalog v1 defines for it plus the envelope
 * properties `@accessibility` and `@metadata`. Component-level `@catalogId` is
 * refused. A test keeps this in step with `question-card-catalog.json`.
 */
export const QUESTION_CARD_COMPONENT_PROPS: Readonly<
  Record<QuestionComponentName, readonly string[]>
> = {
  Column: ['children', 'justify', 'align', 'weight', '@accessibility', '@metadata'],
  Text: ['text', 'variant', 'weight', '@accessibility', '@metadata'],
  ChoicePicker: [
    'label',
    'variant',
    'options',
    'value',
    'displayStyle',
    'filterable',
    'weight',
    '@checks',
    '@accessibility',
    '@metadata',
  ],
  CheckBox: ['label', 'value', 'weight', '@checks', '@accessibility', '@metadata'],
  TextField: [
    'label',
    'value',
    'placeholder',
    'variant',
    'weight',
    '@checks',
    '@accessibility',
    '@metadata',
  ],
  Slider: [
    'label',
    'min',
    'max',
    'value',
    'steps',
    'weight',
    '@checks',
    '@accessibility',
    '@metadata',
  ],
}

export interface QuestionChoiceOption {
  readonly label: string
  readonly value: string
}

interface QuestionInputBase {
  readonly id: string
  /** The question text: card, answer lines, brief writer and read-only card use it. */
  readonly label: string
  /** The `Text` components right before this input, joined by line breaks. */
  readonly description?: string
  /** `@accessibility.label`: the screen-reader name of the field. */
  readonly accessibilityLabel?: string
  /** True when the input carries a `required` check. */
  readonly required: boolean
}

export interface ChoicePickerInput extends QuestionInputBase {
  readonly kind: 'ChoicePicker'
  readonly variant: 'mutuallyExclusive' | 'multipleSelection'
  readonly options: readonly QuestionChoiceOption[]
  readonly initial: readonly string[]
}

export interface CheckBoxInput extends QuestionInputBase {
  readonly kind: 'CheckBox'
  readonly initial: boolean
}

export interface TextFieldInput extends QuestionInputBase {
  readonly kind: 'TextField'
  readonly variant: 'shortText' | 'longText' | 'number'
  readonly placeholder?: string
  /** Always text; a number given for a `number` field is converted. */
  readonly initial: string
}

export interface SliderInput extends QuestionInputBase {
  readonly kind: 'Slider'
  readonly min: number
  readonly max: number
  readonly steps?: number
  readonly initial: number
}

export type QuestionInput = ChoicePickerInput | CheckBoxInput | TextFieldInput | SliderInput

/** What the card draws: a fixed layout of title, description, inputs and footer. */
export interface QuestionSurfaceView {
  /** The model's surface id, echoed back in the action (not a screen key). */
  readonly surfaceId: string
  /** The first of the leading `Text` components. */
  readonly title?: string
  /** The other leading `Text` components, joined by line breaks. */
  readonly description?: string
  /** `Text` components after the last input, joined by line breaks. */
  readonly footer?: string
  readonly inputs: readonly QuestionInput[]
}

/** One answer: string list (ChoicePicker), boolean (CheckBox), text (TextField), number (Slider). */
export type QuestionAnswerValue = readonly string[] | boolean | string | number
export type QuestionAnswers = Readonly<Record<string, QuestionAnswerValue>>

/** What the tool asks the card: the checked view. */
export type QuestionCardRequest = QuestionSurfaceView

/** What the card answers the tool. */
export type QuestionCardAnswer =
  | {
      readonly kind: 'submit'
      readonly answers: QuestionAnswers
      /** ChoicePicker ids the person left to the AI ("decide for me"). */
      readonly decideForMe: readonly string[]
    }
  | { readonly kind: 'skip' }

export type QuestionSurfaceValidation =
  | { readonly ok: true; readonly view: QuestionSurfaceView }
  | { readonly ok: false; readonly errors: readonly string[] }

export interface QuestionSubmitContext {
  readonly answers: QuestionAnswers
  readonly decideForMe: readonly string[]
}

/** An A2UI v1.0 renderer-to-agent `action` message. */
export interface A2uiActionMessage<C> {
  readonly version: typeof A2UI_PROTOCOL_VERSION
  readonly action: {
    readonly name: string
    readonly surfaceId: string
    readonly sourceComponentId: string
    readonly timestamp: string
    readonly context: C
  }
}

export type QuestionSubmitMessage = A2uiActionMessage<QuestionSubmitContext>
export type QuestionSkipMessage = A2uiActionMessage<Readonly<Record<string, never>>>

// ────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>

const MESSAGE_KEYS = new Set(['version', 'createSurface'])
const SURFACE_KEYS = new Set([
  'surfaceId',
  'catalogId',
  'sendDataModel',
  'components',
  'dataModel',
  'metadata',
])
const INPUT_KINDS = new Set<string>(['ChoicePicker', 'CheckBox', 'TextField', 'Slider'])
const COMPONENT_NAMES = Object.keys(QUESTION_CARD_COMPONENT_PROPS)
const ACCEPTED = Object.fromEntries(
  Object.entries(QUESTION_CARD_COMPONENT_PROPS).map(([name, props]) => [name, new Set(props)]),
) as Record<QuestionComponentName, Set<string>>

const JUSTIFY = ['start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly', 'stretch']
const ALIGN = ['center', 'end', 'start', 'stretch']
const TEXT_VARIANTS = ['caption', 'body']
const CHOICE_VARIANTS = ['mutuallyExclusive', 'multipleSelection']
const DISPLAY_STYLES = ['checkbox', 'chips']
const TEXT_FIELD_VARIANTS = ['shortText', 'longText', 'number']

/** UAX #31 identifier, the A2UI rule for component ids. */
const IDENTIFIER = /^[\p{XID_Start}_][\p{XID_Continue}]*$/u

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function pathBinding(id: string): string {
  return JSON.stringify({ '@path': `/${id}` })
}

function isBindingTo(value: unknown, id: string): boolean {
  return isObj(value) && Object.keys(value).length === 1 && value['@path'] === `/${id}`
}

function isRequiredCheckOf(condition: unknown, id: string): boolean {
  if (!isObj(condition)) return false
  const keys = Object.keys(condition)
  if (keys.length !== 2 || condition['@call'] !== 'required') return false
  const args = condition.args
  return isObj(args) && Object.keys(args).length === 1 && isBindingTo(args.value, id)
}

class Problems {
  readonly lines: string[] = []
  add(where: string, reason: string): void {
    this.lines.push(`${where}: ${reason}`)
  }
}

interface ReadComponent {
  readonly index: number
  readonly id: string
  /** Undefined for a component type outside this catalog (already reported). */
  readonly name: QuestionComponentName | undefined
  readonly raw: Obj
}

/** A literal-only text property; returns the trimmed text or undefined after reporting. */
function literalText(
  problems: Problems,
  where: string,
  value: unknown,
  opts: { required: boolean; nonEmpty: boolean },
): string | undefined {
  if (value === undefined) {
    if (opts.required) problems.add(where, 'is required')
    return undefined
  }
  if (isObj(value) && ('@path' in value || '@call' in value)) {
    problems.add(where, 'must be literal text, not a data binding or function call')
    return undefined
  }
  if (typeof value !== 'string') {
    problems.add(where, 'must be a string')
    return undefined
  }
  const text = value.trim()
  if (opts.nonEmpty && !text) {
    problems.add(where, 'must not be empty')
    return undefined
  }
  return text
}

function checkEnum(problems: Problems, where: string, value: unknown, allowed: string[]): void {
  if (value !== undefined && (typeof value !== 'string' || !allowed.includes(value))) {
    problems.add(where, `must be one of ${allowed.join(', ')}`)
  }
}

function checkBoolean(problems: Problems, where: string, value: unknown): void {
  if (value !== undefined && typeof value !== 'boolean')
    problems.add(where, 'must be true or false')
}

function checkNumber(problems: Problems, where: string, value: unknown): boolean {
  if (value === undefined) return true
  if (!isFiniteNumber(value)) {
    problems.add(where, 'must be a number')
    return false
  }
  return true
}

/** Checks the envelope and the common properties; returns the accessibility label. */
function checkCommon(problems: Problems, at: string, raw: Obj): string | undefined {
  let accessibilityLabel: string | undefined
  const a11y = raw['@accessibility']
  if (a11y !== undefined) {
    if (!isObj(a11y)) {
      problems.add(`${at}.@accessibility`, 'must be an object')
    } else {
      // only the label is used; the other accessibility values are ignored
      accessibilityLabel = literalText(problems, `${at}.@accessibility.label`, a11y.label, {
        required: false,
        nonEmpty: false,
      })
      if (accessibilityLabel === '') accessibilityLabel = undefined
    }
  }
  checkNumber(problems, `${at}.weight`, raw.weight)
  return accessibilityLabel
}

/** `@checks`: only `required` on the component's own value. Returns whether one is present. */
function checkChecks(problems: Problems, at: string, id: string, value: unknown): boolean {
  if (value === undefined) return false
  if (!Array.isArray(value)) {
    problems.add(`${at}.@checks`, 'must be a list')
    return false
  }
  let required = false
  value.forEach((rule, k) => {
    const where = `${at}.@checks[${k}]`
    if (!isObj(rule)) {
      problems.add(where, 'must be an object')
      return
    }
    for (const key of Object.keys(rule)) {
      if (key !== 'condition' && key !== 'message')
        problems.add(`${where}.${key}`, 'unknown property')
    }
    if (rule.message !== undefined && typeof rule.message !== 'string') {
      problems.add(`${where}.message`, 'must be a string')
    }
    if (isRequiredCheckOf(rule.condition, id)) {
      required = true
    } else {
      problems.add(
        `${where}.condition`,
        `must be {"@call":"required","args":{"value":${pathBinding(id)}}}`,
      )
    }
  })
  return required
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type InputDraft = DistributiveOmit<QuestionInput, 'description' | 'initial'>

/** Sliders whose min or max was invalid: their data model value is not range-checked. */
const unknownRange = new WeakSet<InputDraft>()

function readInput(problems: Problems, c: ReadComponent): InputDraft | undefined {
  const { raw, id } = c
  const at = `components[${c.index}]`
  const accessibilityLabel = checkCommon(problems, at, raw)
  const label = literalText(problems, `${at}.label`, raw.label, { required: true, nonEmpty: true })
  if (!isBindingTo(raw.value, id)) problems.add(`${at}.value`, `must be ${pathBinding(id)}`)
  const required = checkChecks(problems, at, id, raw['@checks'])
  const base = {
    id,
    label: label ?? '',
    ...(accessibilityLabel !== undefined ? { accessibilityLabel } : {}),
    required,
  }
  switch (c.name) {
    case 'ChoicePicker': {
      checkEnum(problems, `${at}.variant`, raw.variant, CHOICE_VARIANTS)
      checkEnum(problems, `${at}.displayStyle`, raw.displayStyle, DISPLAY_STYLES)
      checkBoolean(problems, `${at}.filterable`, raw.filterable)
      const options: QuestionChoiceOption[] = []
      if (raw.options === undefined) {
        problems.add(`${at}.options`, 'is required')
      } else if (
        !Array.isArray(raw.options) ||
        raw.options.length < 1 ||
        raw.options.length > QUESTION_CARD_MAX_OPTIONS
      ) {
        problems.add(`${at}.options`, `must hold 1 to ${QUESTION_CARD_MAX_OPTIONS} options`)
      } else {
        const seen = new Set<string>()
        raw.options.forEach((option: unknown, k: number) => {
          const where = `${at}.options[${k}]`
          if (!isObj(option)) {
            problems.add(where, 'must be an object with label and value')
            return
          }
          for (const key of Object.keys(option)) {
            if (key !== 'label' && key !== 'value')
              problems.add(`${where}.${key}`, 'unknown property')
          }
          const optionLabel = literalText(problems, `${where}.label`, option.label, {
            required: true,
            nonEmpty: true,
          })
          let value: string | undefined
          if (option.value === undefined) problems.add(`${where}.value`, 'is required')
          else if (typeof option.value !== 'string')
            problems.add(`${where}.value`, 'must be a string')
          else if (seen.has(option.value))
            problems.add(`${where}.value`, `${JSON.stringify(option.value)} is used more than once`)
          else value = option.value
          if (value !== undefined) seen.add(value)
          if (optionLabel !== undefined && value !== undefined)
            options.push({ label: optionLabel, value })
        })
      }
      const variant =
        raw.variant === 'multipleSelection' ? 'multipleSelection' : 'mutuallyExclusive'
      return { ...base, kind: 'ChoicePicker', variant, options }
    }
    case 'CheckBox':
      return { ...base, kind: 'CheckBox' }
    case 'TextField': {
      if (raw.variant === 'obscured') problems.add(`${at}.variant`, '"obscured" is not accepted')
      else checkEnum(problems, `${at}.variant`, raw.variant, TEXT_FIELD_VARIANTS)
      const placeholder = literalText(problems, `${at}.placeholder`, raw.placeholder, {
        required: false,
        nonEmpty: false,
      })
      const variant =
        raw.variant === 'longText' || raw.variant === 'number' ? raw.variant : 'shortText'
      return {
        ...base,
        kind: 'TextField',
        variant,
        ...(placeholder ? { placeholder } : {}),
      }
    }
    case 'Slider': {
      const minOk = checkNumber(problems, `${at}.min`, raw.min)
      const min = minOk && isFiniteNumber(raw.min) ? raw.min : 0
      let max = min + 1
      let rangeKnown = minOk
      if (raw.max === undefined) {
        problems.add(`${at}.max`, 'is required')
        rangeKnown = false
      } else if (checkNumber(problems, `${at}.max`, raw.max) && isFiniteNumber(raw.max)) {
        if (raw.max <= min) problems.add(`${at}.max`, 'must be greater than min')
        max = raw.max
      } else {
        rangeKnown = false
      }
      let steps: number | undefined
      if (raw.steps !== undefined) {
        if (typeof raw.steps === 'number' && Number.isInteger(raw.steps) && raw.steps >= 1) {
          steps = raw.steps
        } else {
          problems.add(`${at}.steps`, 'must be an integer of 1 or more')
        }
      }
      const slider: InputDraft = {
        ...base,
        kind: 'Slider',
        min,
        max,
        ...(steps !== undefined ? { steps } : {}),
      }
      if (!rangeKnown) unknownRange.add(slider)
      return slider
    }
    default:
      return undefined
  }
}

function emptyValueOf(draft: InputDraft): QuestionAnswerValue {
  switch (draft.kind) {
    case 'ChoicePicker':
      return []
    case 'CheckBox':
      return false
    case 'TextField':
      return ''
    case 'Slider':
      return draft.min
  }
}

/** Checks one data model value; returns the normalized value or undefined after reporting. */
function readDataValue(
  problems: Problems,
  where: string,
  draft: InputDraft,
  value: unknown,
): QuestionAnswerValue | undefined {
  switch (draft.kind) {
    case 'ChoicePicker': {
      if (!Array.isArray(value)) {
        problems.add(where, 'must be a list of option values')
        return undefined
      }
      const allowed = new Set(draft.options.map((o) => o.value))
      const seen = new Set<string>()
      let ok = true
      value.forEach((v: unknown, k: number) => {
        if (typeof v !== 'string') {
          problems.add(`${where}[${k}]`, 'must be a string')
          ok = false
        } else if (!allowed.has(v)) {
          problems.add(`${where}[${k}]`, `${JSON.stringify(v)} is not an option value`)
          ok = false
        } else if (seen.has(v)) {
          problems.add(`${where}[${k}]`, `${JSON.stringify(v)} is listed more than once`)
          ok = false
        } else {
          seen.add(v)
        }
      })
      if (ok && draft.variant === 'mutuallyExclusive' && value.length > 1) {
        problems.add(where, 'a mutuallyExclusive picker holds at most one value')
        ok = false
      }
      return ok ? (value as string[]).slice() : undefined
    }
    case 'CheckBox':
      if (typeof value !== 'boolean') {
        problems.add(where, 'must be true or false')
        return undefined
      }
      return value
    case 'TextField':
      if (typeof value === 'string') return value
      if (draft.variant === 'number' && isFiniteNumber(value)) return String(value)
      problems.add(where, 'must be a string')
      return undefined
    case 'Slider':
      if (unknownRange.has(draft)) {
        if (isFiniteNumber(value)) return value
        problems.add(where, 'must be a number')
        return undefined
      }
      if (!isFiniteNumber(value) || value < draft.min || value > draft.max) {
        problems.add(where, `must be a number from ${draft.min} to ${draft.max}`)
        return undefined
      }
      return value
  }
}

function joinLines(parts: string[]): string | undefined {
  return parts.length ? parts.join('\n') : undefined
}

function validateUnsafe(raw: unknown): QuestionSurfaceValidation {
  const problems = new Problems()
  const fail = (): QuestionSurfaceValidation => ({
    ok: false,
    errors: problems.lines.slice(0, QUESTION_CARD_MAX_ERRORS),
  })

  if (!isObj(raw)) {
    problems.add('(message)', 'must be an A2UI v1.0 createSurface message object')
    return fail()
  }
  if (raw.version !== A2UI_PROTOCOL_VERSION) problems.add('version', 'must be "1.0"')
  for (const key of Object.keys(raw)) {
    if (!MESSAGE_KEYS.has(key)) {
      problems.add(
        key,
        'unknown property (the input is one createSurface message: version and createSurface)',
      )
    }
  }
  const surface = raw.createSurface
  if (!isObj(surface)) {
    problems.add('createSurface', 'must be an object')
    return fail()
  }
  for (const key of Object.keys(surface)) {
    if (!SURFACE_KEYS.has(key)) problems.add(key, 'unknown property')
  }
  const surfaceId = typeof surface.surfaceId === 'string' ? surface.surfaceId : ''
  if (!surfaceId.trim()) problems.add('surfaceId', 'must be a non-empty string')
  if (surface.catalogId !== undefined && surface.catalogId !== QUESTION_CARD_CATALOG_ID) {
    problems.add('catalogId', `must be "${QUESTION_CARD_CATALOG_ID}" or left out`)
  }
  // sendDataModel and metadata are accepted and ignored

  if (!Array.isArray(surface.components)) {
    problems.add('components', 'must be a list of components')
    return fail()
  }

  // components: identity, type and properties
  const read: ReadComponent[] = []
  const byId = new Map<string, ReadComponent>()
  surface.components.forEach((rawComponent: unknown, index: number) => {
    const at = `components[${index}]`
    if (!isObj(rawComponent)) {
      problems.add(at, 'must be an object')
      return
    }
    // an id that breaks a naming rule is reported but still resolves as a child,
    // so one mistake does not cascade into "missing child" lines
    const id = rawComponent.id
    let idUsable = false
    if (typeof id !== 'string' || !id) {
      problems.add(`${at}.id`, 'must be a non-empty string')
    } else if (byId.has(id)) {
      problems.add(`${at}.id`, `${JSON.stringify(id)} is used more than once`)
    } else {
      idUsable = true
      if (!IDENTIFIER.test(id)) {
        problems.add(
          `${at}.id`,
          'must be a Unicode identifier (letters, digits, _; not starting with a digit)',
        )
      } else if (id.startsWith(QUESTION_CARD_RESERVED_ID_PREFIX)) {
        problems.add(
          `${at}.id`,
          `ids starting with "${QUESTION_CARD_RESERVED_ID_PREFIX}" are reserved for the app`,
        )
      }
    }

    const rawName = rawComponent.component
    const name =
      typeof rawName === 'string' && COMPONENT_NAMES.includes(rawName)
        ? (rawName as QuestionComponentName)
        : undefined
    if (!name) {
      problems.add(
        `${at}.component`,
        `${typeof rawName === 'string' ? JSON.stringify(rawName) : 'a missing component'} is not in this catalog (use Column, Text, ChoicePicker, CheckBox, TextField or Slider)`,
      )
    } else {
      const accepted = ACCEPTED[name]
      for (const key of Object.keys(rawComponent)) {
        if (key === 'id' || key === 'component') continue
        if (key === '@catalogId') {
          problems.add(`${at}.@catalogId`, 'not accepted; set catalogId on createSurface')
        } else if (!accepted.has(key)) {
          problems.add(`${at}.${key}`, 'unknown property')
        }
      }
    }
    if (!idUsable) return
    const entry: ReadComponent = { index, id: id as string, name, raw: rawComponent }
    read.push(entry)
    byId.set(entry.id, entry)
  })

  // the root and its children
  const root = byId.get('root')
  if (root && root.name !== 'Column') {
    problems.add(
      `components[${root.index}].component`,
      'the component with id "root" must be a Column',
    )
  }
  if (!root || root.name !== 'Column') {
    problems.add('components', 'needs one Column with id "root"')
    return fail()
  }
  const rootAt = `components[${root.index}]`
  checkCommon(problems, rootAt, root.raw)
  checkEnum(problems, `${rootAt}.justify`, root.raw.justify, JUSTIFY)
  checkEnum(problems, `${rootAt}.align`, root.raw.align, ALIGN)

  const order: ReadComponent[] = []
  const children = root.raw.children
  if (!Array.isArray(children)) {
    // a template object or anything else: nothing below can be read
    problems.add(`${rootAt}.children`, 'must be a list of component ids')
    return fail()
  } else {
    const listed = new Set<string>()
    children.forEach((child: unknown, k: number) => {
      const where = `${rootAt}.children[${k}]`
      if (typeof child !== 'string') {
        problems.add(where, 'must be a component id')
        return
      }
      if (child === 'root') {
        problems.add(where, 'root cannot be its own child')
        return
      }
      if (listed.has(child)) {
        problems.add(where, `${JSON.stringify(child)} is listed more than once`)
        return
      }
      listed.add(child)
      const found = byId.get(child)
      if (!found) {
        problems.add(where, `no component has id ${JSON.stringify(child)}`)
        return
      }
      order.push(found)
    })
    for (const c of read) {
      if (c === root) continue
      if (c.name === 'Column')
        problems.add(`components[${c.index}]`, 'Column is only allowed as the root')
      else if (!listed.has(c.id)) problems.add(`components[${c.index}]`, 'not a child of root')
    }
  }

  // children in screen order: texts and inputs
  const drafts: { draft: InputDraft; description?: string }[] = []
  let title: string | undefined
  const intro: string[] = []
  let pending: string[] = []
  let seenInput = false
  for (const c of order) {
    if (c.name === undefined || c.name === 'Column') continue
    const at = `components[${c.index}]`
    if (c.name === 'Text') {
      checkCommon(problems, at, c.raw)
      checkEnum(problems, `${at}.variant`, c.raw.variant, TEXT_VARIANTS)
      const text = literalText(problems, `${at}.text`, c.raw.text, {
        required: true,
        nonEmpty: true,
      })
      if (text === undefined) continue
      if (seenInput) pending.push(text)
      else if (title === undefined) title = text
      else intro.push(text)
      continue
    }
    const draft = readInput(problems, c)
    if (!draft) continue
    const description = joinLines(seenInput ? pending : [])
    seenInput = true
    pending = []
    drafts.push(description !== undefined ? { draft, description } : { draft })
  }
  const footer = joinLines(pending)
  const inputCount = order.filter((c) => c.name !== undefined && INPUT_KINDS.has(c.name)).length
  if (inputCount < 1 || inputCount > QUESTION_CARD_MAX_INPUTS) {
    problems.add(
      'components',
      `needs 1 to ${QUESTION_CARD_MAX_INPUTS} input components (ChoicePicker, CheckBox, TextField, Slider), found ${inputCount}`,
    )
  }

  // the data model
  const initial = new Map<string, QuestionAnswerValue>()
  const dataModel = surface.dataModel
  if (dataModel !== undefined) {
    if (!isObj(dataModel)) {
      problems.add('dataModel', 'must be an object')
    } else {
      const draftById = new Map(drafts.map((d) => [d.draft.id, d.draft]))
      for (const [key, value] of Object.entries(dataModel)) {
        const draft = draftById.get(key)
        if (!draft) {
          problems.add(`dataModel.${key}`, 'not the id of an input component')
          continue
        }
        const read = readDataValue(problems, `dataModel.${key}`, draft, value)
        if (read !== undefined) initial.set(key, read)
      }
    }
  }

  if (problems.lines.length) return fail()

  const inputs = drafts.map(({ draft, description }) => {
    const value = initial.get(draft.id) ?? emptyValueOf(draft)
    return {
      ...draft,
      ...(description !== undefined ? { description } : {}),
      initial: value,
    } as QuestionInput
  })
  const introText = joinLines(intro)
  return {
    ok: true,
    view: {
      surfaceId,
      ...(title !== undefined ? { title } : {}),
      ...(introText !== undefined ? { description: introText } : {}),
      ...(footer !== undefined ? { footer } : {}),
      inputs,
    },
  }
}

/**
 * Checks an `ask_questions` input (one A2UI v1.0 `createSurface` message) against
 * every rule of the question card format. On success returns the view the card
 * draws; on failure up to ten English lines `<location>: <reason>`. Never throws.
 */
export function validateQuestionSurface(raw: unknown): QuestionSurfaceValidation {
  try {
    return validateUnsafe(raw)
  } catch {
    // getters or proxies in an odd input; never let the tool path throw
    return { ok: false, errors: ['(message): could not be read'] }
  }
}

// ────────────────────────────────────────────────────────────
// Answers and actions
// ────────────────────────────────────────────────────────────

/** The empty answer of an input: `[]`, `false`, `""` or `min`. */
export function emptyAnswerOf(input: QuestionInput): QuestionAnswerValue {
  return emptyValueOf(input)
}

/**
 * Fits an answer to its input: wrong types give undefined, choice lists keep
 * only option values (one for mutuallyExclusive), numbers in text fields become
 * text and Slider numbers are kept inside min..max.
 */
export function fitAnswer(input: QuestionInput, value: unknown): QuestionAnswerValue | undefined {
  switch (input.kind) {
    case 'ChoicePicker': {
      if (!Array.isArray(value)) return undefined
      const allowed = new Set(input.options.map((o) => o.value))
      const picked: string[] = []
      for (const v of value) {
        if (typeof v === 'string' && allowed.has(v) && !picked.includes(v)) picked.push(v)
      }
      return input.variant === 'mutuallyExclusive' ? picked.slice(0, 1) : picked
    }
    case 'CheckBox':
      return typeof value === 'boolean' ? value : undefined
    case 'TextField':
      if (typeof value === 'string') return value
      return input.variant === 'number' && isFiniteNumber(value) ? String(value) : undefined
    case 'Slider':
      return isFiniteNumber(value) ? Math.min(input.max, Math.max(input.min, value)) : undefined
  }
}

function timestampOf(now: Date | number): string {
  const date = now instanceof Date ? now : new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

/**
 * The tool output when the person submits (A2UI `action` "submit" from the app's
 * `ieum_submit` button). Every input not left to the AI is in `answers` with its
 * current value (empty values included); an input missing from `answers` or with
 * an unfitting value keeps its initial value. `decideForMe` keeps the card's
 * ChoicePicker ids only, in screen order.
 */
export function submitAction(
  view: QuestionSurfaceView,
  answers: Readonly<Record<string, unknown>>,
  decideForMe: readonly string[],
  now: Date | number,
): QuestionSubmitMessage {
  const asked = new Set(decideForMe)
  const decided: string[] = []
  const out: Record<string, QuestionAnswerValue> = {}
  for (const input of view.inputs) {
    if (input.kind === 'ChoicePicker' && asked.has(input.id)) {
      decided.push(input.id)
      continue
    }
    const given = Object.prototype.hasOwnProperty.call(answers, input.id)
      ? answers[input.id]
      : undefined
    out[input.id] = fitAnswer(input, given) ?? input.initial
  }
  return {
    version: A2UI_PROTOCOL_VERSION,
    action: {
      name: QUESTION_SUBMIT_ACTION,
      surfaceId: view.surfaceId,
      sourceComponentId: QUESTION_SUBMIT_COMPONENT_ID,
      timestamp: timestampOf(now),
      context: { answers: out, decideForMe: decided },
    },
  }
}

/** The tool output when the card is skipped, the run stops or a new message closes it. */
export function skipAction(view: QuestionSurfaceView, now: Date | number): QuestionSkipMessage {
  return {
    version: A2UI_PROTOCOL_VERSION,
    action: {
      name: QUESTION_SKIP_ACTION,
      surfaceId: view.surfaceId,
      sourceComponentId: QUESTION_SKIP_COMPONENT_ID,
      timestamp: timestampOf(now),
      context: {},
    },
  }
}

/** The A2UI action message for a card answer. */
export function questionAnswerAction(
  view: QuestionSurfaceView,
  answer: QuestionCardAnswer,
  now: Date | number,
): QuestionSubmitMessage | QuestionSkipMessage {
  return answer.kind === 'submit'
    ? submitAction(view, answer.answers, answer.decideForMe, now)
    : skipAction(view, now)
}
