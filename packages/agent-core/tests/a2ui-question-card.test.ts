import { describe, expect, it } from 'vitest'
import {
  QUESTION_CARD_CATALOG_ID,
  QUESTION_CARD_MAX_ERRORS,
  QUESTION_SKIP_COMPONENT_ID,
  QUESTION_SUBMIT_COMPONENT_ID,
  skipAction,
  submitAction,
  validateQuestionSurface,
  type QuestionSurfaceView,
} from '../src/a2ui-question-card'
import * as index from '../src/index'
import {
  clone,
  componentOf,
  everyPropertyExample,
  specExample,
  surfaceOf,
} from './question-card-fixtures'

function errorsOf(raw: unknown): readonly string[] {
  const result = validateQuestionSurface(raw)
  if (result.ok) throw new Error('expected a failure')
  return result.errors
}

function viewOf(raw: unknown): QuestionSurfaceView {
  const result = validateQuestionSurface(raw)
  if (!result.ok) throw new Error(`expected success: ${result.errors.join(' | ')}`)
  return result.view
}

/** Builds the spec example, lets the test change it, and returns the errors. */
function errorsAfter(edit: (message: Record<string, unknown>) => void): readonly string[] {
  const message = specExample()
  edit(message)
  return errorsOf(message)
}

function components(message: Record<string, unknown>): Record<string, unknown>[] {
  return surfaceOf(message).components as Record<string, unknown>[]
}

function rootChildren(message: Record<string, unknown>): string[] {
  return componentOf(message, 'root').children as string[]
}

describe('validateQuestionSurface: valid messages', () => {
  it('reads the spec example into the view the card draws', () => {
    const view = viewOf(specExample())
    expect(view).toEqual({
      surfaceId: 'deck-scope',
      title: '발표 자료 방향을 정해 주세요',
      inputs: [
        {
          kind: 'ChoicePicker',
          id: 'audience',
          label: '누가 듣나요?',
          required: true,
          variant: 'mutuallyExclusive',
          options: [
            { label: '학부모', value: 'parents' },
            { label: '동료 교사', value: 'teachers' },
          ],
          initial: [],
        },
        {
          kind: 'Slider',
          id: 'length',
          label: '장 수',
          required: false,
          min: 5,
          max: 20,
          steps: 15,
          initial: 10,
        },
        {
          kind: 'TextField',
          id: 'notes',
          label: '그 밖에 바라는 점',
          required: false,
          variant: 'longText',
          initial: '',
        },
      ],
    })
  })

  it('accepts every catalog property, drops the unused ones and keeps screen order', () => {
    const view = viewOf(everyPropertyExample())
    expect(view.title).toBe('Pick a direction')
    expect(view.description).toBe('Two quick questions.')
    expect(view.footer).toBe('Thanks.')
    expect(view.inputs.map((i) => i.id)).toEqual(['pick', 'agree', 'count', 'name', 'level'])
    const [pick, agree, count, name, level] = view.inputs
    expect(pick).toEqual({
      kind: 'ChoicePicker',
      id: 'pick',
      label: 'Topics',
      accessibilityLabel: 'Topic list',
      required: true,
      variant: 'multipleSelection',
      options: [
        { label: 'Alpha', value: 'a' },
        { label: 'Beta', value: 'b' },
        { label: 'Gamma', value: 'c' },
      ],
      initial: ['a', 'c'],
    })
    expect(agree).toEqual({
      kind: 'CheckBox',
      id: 'agree',
      label: 'Include a summary',
      description: 'Tick if needed.',
      required: false,
      initial: true,
    })
    // a number in a number field's data model is taken as text
    expect(count).toEqual({
      kind: 'TextField',
      id: 'count',
      label: 'How many pages?',
      required: false,
      variant: 'number',
      placeholder: 'e.g. 10',
      initial: '12',
    })
    expect(name).toMatchObject({ kind: 'TextField', variant: 'shortText', initial: '' })
    expect(level).toEqual({
      kind: 'Slider',
      id: 'level',
      label: 'Detail',
      required: false,
      min: 0,
      max: 3,
      initial: 2,
    })
    for (const input of view.inputs) {
      expect(input).not.toHaveProperty('weight')
      expect(input).not.toHaveProperty('displayStyle')
      expect(input).not.toHaveProperty('filterable')
    }
  })

  it('starts inputs without a data model key from the empty value', () => {
    const message = everyPropertyExample()
    delete surfaceOf(message).dataModel
    const view = viewOf(message)
    expect(view.inputs.map((i) => i.initial)).toEqual([[], false, '', '', 0])
  })

  it('accepts a missing catalogId and ignores sendDataModel and metadata', () => {
    const message = specExample()
    delete surfaceOf(message).catalogId
    surfaceOf(message).sendDataModel = 'anything'
    surfaceOf(message).metadata = { whatever: true }
    expect(validateQuestionSurface(message).ok).toBe(true)
  })

  it('accepts a title-less card and one input, and up to five inputs and seven options', () => {
    const one = {
      version: '1.0',
      createSurface: {
        surfaceId: 's',
        components: [
          { id: 'root', component: 'Column', children: ['ok'] },
          { id: 'ok', component: 'CheckBox', label: 'OK?', value: { '@path': '/ok' } },
        ],
      },
    }
    const view = viewOf(one)
    expect(view.title).toBeUndefined()
    expect(view.inputs).toHaveLength(1)

    const five = clone(one)
    const list = five.createSurface.components as Record<string, unknown>[]
    const children = list[0]!.children as string[]
    for (const id of ['b', 'c', 'd', 'e']) {
      children.push(id)
      list.push({ id, component: 'CheckBox', label: id, value: { '@path': `/${id}` } })
    }
    expect(viewOf(five).inputs).toHaveLength(5)

    const seven = specExample()
    componentOf(seven, 'audience').options = Array.from({ length: 7 }, (_, i) => ({
      label: `L${i}`,
      value: `v${i}`,
    }))
    expect(validateQuestionSurface(seven).ok).toBe(true)
  })

  it('accepts Unicode identifiers', () => {
    const message = {
      version: '1.0',
      createSurface: {
        surfaceId: 's',
        components: [
          { id: 'root', component: 'Column', children: ['대상_1'] },
          { id: '대상_1', component: 'TextField', label: 'x', value: { '@path': '/대상_1' } },
        ],
      },
    }
    expect(validateQuestionSurface(message).ok).toBe(true)
  })

  it('takes one value for a mutuallyExclusive picker and keeps a data model choice', () => {
    const message = specExample()
    surfaceOf(message).dataModel = { audience: ['teachers'] }
    expect(viewOf(message).inputs[0]!.initial).toEqual(['teachers'])
  })
})

describe('validateQuestionSurface: errors', () => {
  it('never throws, whatever it is given', () => {
    const odd: unknown[] = [
      undefined,
      null,
      0,
      'text',
      [],
      { version: '1.0' },
      { version: '1.0', createSurface: null },
      { version: '1.0', createSurface: { surfaceId: 's', components: [null, 1, 'x', []] } },
      { version: '1.0', createSurface: { surfaceId: 's', components: {} } },
      {
        version: '1.0',
        createSurface: {
          surfaceId: 's',
          components: [{ id: 'root', component: 'Column', children: [1, null, {}] }],
          dataModel: [],
        },
      },
    ]
    const cyclic: Record<string, unknown> = { version: '1.0' }
    cyclic.createSurface = cyclic
    odd.push(cyclic)
    for (const raw of odd) {
      const result = validateQuestionSurface(raw)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors.length).toBeGreaterThan(0)
    }
  })

  it('names the location and the reason in each line, in English', () => {
    const errors = errorsAfter((m) => {
      componentOf(m, 'audience').value = { '@path': '/other' }
    })
    expect(errors).toEqual(['components[2].value: must be {"@path":"/audience"}'])
  })

  it('returns at most ten lines', () => {
    const message = specExample()
    const list = components(message)
    for (const c of list) {
      if (c.id === 'root') continue
      c.extra1 = 1
      c.extra2 = 2
      c.extra3 = 3
    }
    const errors = errorsOf(message)
    expect(errors).toHaveLength(QUESTION_CARD_MAX_ERRORS)
    expect(QUESTION_CARD_MAX_ERRORS).toBe(10)
  })

  it('checks the message envelope', () => {
    expect(errorsOf([])).toEqual([expect.stringMatching(/^\(message\): /)])
    expect(errorsAfter((m) => (m.version = 1))).toEqual(['version: must be "1.0"'])
    expect(errorsAfter((m) => delete m.version)).toEqual(['version: must be "1.0"'])
    expect(errorsAfter((m) => (m.updateComponents = {}))).toEqual([
      expect.stringMatching(/^updateComponents: unknown property/),
    ])
    expect(errorsOf({ version: '1.0' })).toEqual([expect.stringMatching(/^createSurface: /)])
    expect(errorsAfter((m) => (surfaceOf(m).theme = {}))).toEqual([
      expect.stringMatching(/^theme: unknown property/),
    ])
  })

  it('checks surfaceId and catalogId', () => {
    expect(errorsAfter((m) => delete surfaceOf(m).surfaceId)).toEqual([
      expect.stringMatching(/^surfaceId: /),
    ])
    expect(errorsAfter((m) => (surfaceOf(m).surfaceId = '  '))).toEqual([
      expect.stringMatching(/^surfaceId: /),
    ])
    expect(
      errorsAfter((m) => {
        surfaceOf(m).catalogId = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json'
      }),
    ).toEqual([`catalogId: must be "${QUESTION_CARD_CATALOG_ID}" or left out`])
  })

  it('needs exactly one Column with id "root"', () => {
    expect(
      errorsAfter((m) => {
        componentOf(m, 'root').id = 'top'
      }),
    ).toContain('components: needs one Column with id "root"')
    expect(
      errorsAfter((m) => {
        componentOf(m, 'root').component = 'Text'
        componentOf(m, 'root').text = 'x'
        delete componentOf(m, 'root').children
      }),
    ).toContain('components[0].component: the component with id "root" must be a Column')
    expect(errorsAfter((m) => (surfaceOf(m).components = []))).toEqual([
      'components: needs one Column with id "root"',
    ])
  })

  it('rejects nesting, orphans, missing children, repeated children and repeated ids', () => {
    // nesting: a second Column under root
    const nested = errorsAfter((m) => {
      rootChildren(m).push('group')
      components(m).push({ id: 'group', component: 'Column', children: ['notes'] })
    })
    expect(nested).toContain('components[5]: Column is only allowed as the root')

    expect(
      errorsAfter((m) => {
        components(m).push({ id: 'stray', component: 'Text', text: 'x' })
      }),
    ).toEqual(['components[5]: not a child of root'])

    expect(errorsAfter((m) => rootChildren(m).push('ghost'))).toEqual([
      'components[0].children[4]: no component has id "ghost"',
    ])

    expect(errorsAfter((m) => rootChildren(m).push('notes'))).toEqual([
      'components[0].children[4]: "notes" is listed more than once',
    ])

    expect(errorsAfter((m) => rootChildren(m).push('root'))).toEqual([
      'components[0].children[4]: root cannot be its own child',
    ])

    expect(
      errorsAfter((m) => {
        components(m).push({ id: 'notes', component: 'Text', text: 'x' })
      }),
    ).toContain('components[5].id: "notes" is used more than once')

    expect(
      errorsAfter((m) => {
        componentOf(m, 'root').children = { componentId: 'notes', path: '/items' }
      }),
    ).toEqual(['components[0].children: must be a list of component ids'])
  })

  it('checks component ids', () => {
    expect(
      errorsAfter((m) => {
        componentOf(m, 'notes').id = 'my-notes'
        rootChildren(m)[3] = 'my-notes'
      }),
    ).toContain(
      'components[4].id: must be a Unicode identifier (letters, digits, _; not starting with a digit)',
    )
    expect(
      errorsAfter((m) => {
        componentOf(m, 'notes').id = '1notes'
        rootChildren(m)[3] = '1notes'
      }),
    ).toContain(
      'components[4].id: must be a Unicode identifier (letters, digits, _; not starting with a digit)',
    )
    expect(
      errorsAfter((m) => {
        componentOf(m, 'notes').id = 'ieum_notes'
        componentOf(m, 'ieum_notes').value = { '@path': '/ieum_notes' }
        rootChildren(m)[3] = 'ieum_notes'
        surfaceOf(m).dataModel = { audience: [], length: 10 }
      }),
    ).toEqual(['components[4].id: ids starting with "ieum_" are reserved for the app'])
    expect(
      errorsAfter((m) => {
        delete componentOf(m, 'title').id
      }),
    ).toContain('components[1].id: must be a non-empty string')
  })

  it('rejects components outside the catalog', () => {
    expect(
      errorsAfter((m) => {
        rootChildren(m).push('go')
        components(m).push({ id: 'go', component: 'Button', child: 'title' })
      }),
    ).toEqual([
      'components[5].component: "Button" is not in this catalog (use Column, Text, ChoicePicker, CheckBox, TextField or Slider)',
    ])
  })

  it('needs one to five inputs', () => {
    expect(
      errorsOf({
        version: '1.0',
        createSurface: {
          surfaceId: 's',
          components: [
            { id: 'root', component: 'Column', children: ['t'] },
            { id: 't', component: 'Text', text: 'Hi' },
          ],
        },
      }),
    ).toEqual([
      'components: needs 1 to 5 input components (ChoicePicker, CheckBox, TextField, Slider), found 0',
    ])

    const message = specExample()
    for (const id of ['a1', 'a2', 'a3']) {
      rootChildren(message).push(id)
      components(message).push({
        id,
        component: 'CheckBox',
        label: id,
        value: { '@path': `/${id}` },
      })
    }
    expect(errorsOf(message)).toEqual([
      'components: needs 1 to 5 input components (ChoicePicker, CheckBox, TextField, Slider), found 6',
    ])
  })

  it('needs one to seven options with unique values', () => {
    expect(errorsAfter((m) => (componentOf(m, 'audience').options = []))).toEqual([
      'components[2].options: must hold 1 to 7 options',
    ])
    expect(
      errorsAfter((m) => {
        componentOf(m, 'audience').options = Array.from({ length: 8 }, (_, i) => ({
          label: `L${i}`,
          value: `v${i}`,
        }))
      }),
    ).toEqual(['components[2].options: must hold 1 to 7 options'])
    expect(
      errorsAfter((m) => {
        componentOf(m, 'audience').options = [
          { label: 'A', value: 'x' },
          { label: 'B', value: 'x' },
        ]
      }),
    ).toEqual(['components[2].options[1].value: "x" is used more than once'])
    expect(
      errorsAfter((m) => {
        componentOf(m, 'audience').options = [{ label: 'A', value: 'a', icon: 'star' }]
        surfaceOf(m).dataModel = {}
      }),
    ).toEqual(['components[2].options[0].icon: unknown property'])
    expect(
      errorsAfter((m) => {
        componentOf(m, 'audience').options = [{ label: 'A', value: 1 }]
      }),
    ).toEqual(['components[2].options[0].value: must be a string'])
    expect(errorsAfter((m) => delete componentOf(m, 'audience').options)).toEqual([
      'components[2].options: is required',
    ])
  })

  it('needs a literal label on every input', () => {
    expect(errorsAfter((m) => delete componentOf(m, 'audience').label)).toEqual([
      'components[2].label: is required',
    ])
    expect(errorsAfter((m) => delete componentOf(m, 'length').label)).toEqual([
      'components[3].label: is required',
    ])
    expect(errorsAfter((m) => (componentOf(m, 'notes').label = ' '))).toEqual([
      'components[4].label: must not be empty',
    ])
  })

  it('needs value bound to the component id', () => {
    expect(errorsAfter((m) => (componentOf(m, 'notes').value = 'hello'))).toEqual([
      'components[4].value: must be {"@path":"/notes"}',
    ])
    expect(
      errorsAfter((m) => {
        componentOf(m, 'notes').value = { '@call': 'formatString', args: { value: 'x' } }
      }),
    ).toEqual(['components[4].value: must be {"@path":"/notes"}'])
    expect(errorsAfter((m) => (componentOf(m, 'notes').value = { '@path': 'notes' }))).toEqual([
      'components[4].value: must be {"@path":"/notes"}',
    ])
    expect(errorsAfter((m) => delete componentOf(m, 'notes').value)).toEqual([
      'components[4].value: must be {"@path":"/notes"}',
    ])
  })

  it('takes text properties only as literal strings', () => {
    const binding = { '@path': '/title' }
    const call = { '@call': 'formatString', args: { value: 'x' } }
    expect(errorsAfter((m) => (componentOf(m, 'title').text = binding))).toEqual([
      'components[1].text: must be literal text, not a data binding or function call',
    ])
    expect(errorsAfter((m) => (componentOf(m, 'audience').label = call))).toEqual([
      'components[2].label: must be literal text, not a data binding or function call',
    ])
    expect(
      errorsAfter((m) => {
        ;(componentOf(m, 'audience').options as Record<string, unknown>[])[0]!.label = binding
      }),
    ).toEqual([
      'components[2].options[0].label: must be literal text, not a data binding or function call',
    ])
    expect(errorsAfter((m) => (componentOf(m, 'notes').placeholder = binding))).toEqual([
      'components[4].placeholder: must be literal text, not a data binding or function call',
    ])
    expect(
      errorsAfter((m) => {
        componentOf(m, 'notes')['@accessibility'] = { label: binding }
      }),
    ).toEqual([
      'components[4].@accessibility.label: must be literal text, not a data binding or function call',
    ])
    expect(errorsAfter((m) => (componentOf(m, 'title').text = 3))).toEqual([
      'components[1].text: must be a string',
    ])
  })

  it('rejects unknown properties and component-level @catalogId', () => {
    expect(errorsAfter((m) => (componentOf(m, 'notes').maxLength = 3))).toEqual([
      'components[4].maxLength: unknown property',
    ])
    expect(errorsAfter((m) => (componentOf(m, 'title').label = 'x'))).toEqual([
      'components[1].label: unknown property',
    ])
    expect(
      errorsAfter((m) => (componentOf(m, 'notes')['@catalogId'] = QUESTION_CARD_CATALOG_ID)),
    ).toEqual(['components[4].@catalogId: not accepted; set catalogId on createSurface'])
    // the old flat shape is not this format
    expect(errorsAfter((m) => (componentOf(m, 'audience').allowCustom = true))).toEqual([
      'components[2].allowCustom: unknown property',
    ])
  })

  it('checks the values of accepted-but-unused properties', () => {
    expect(errorsAfter((m) => (componentOf(m, 'root').justify = 'middle'))).toEqual([
      'components[0].justify: must be one of start, center, end, spaceBetween, spaceAround, spaceEvenly, stretch',
    ])
    expect(errorsAfter((m) => (componentOf(m, 'audience').displayStyle = 'radio'))).toEqual([
      'components[2].displayStyle: must be one of checkbox, chips',
    ])
    expect(errorsAfter((m) => (componentOf(m, 'audience').filterable = 'yes'))).toEqual([
      'components[2].filterable: must be true or false',
    ])
    expect(errorsAfter((m) => (componentOf(m, 'notes').weight = '1'))).toEqual([
      'components[4].weight: must be a number',
    ])
    expect(errorsAfter((m) => (componentOf(m, 'title').variant = 'h1'))).toEqual([
      'components[1].variant: must be one of caption, body',
    ])
  })

  it('takes @checks only on inputs and only as required on its own value', () => {
    expect(
      errorsAfter((m) => {
        componentOf(m, 'title')['@checks'] = []
      }),
    ).toEqual(['components[1].@checks: unknown property'])
    expect(
      errorsAfter((m) => {
        componentOf(m, 'notes')['@checks'] = [
          { condition: { '@call': 'email', args: { value: { '@path': '/notes' } } } },
        ]
      }),
    ).toEqual([
      'components[4].@checks[0].condition: must be {"@call":"required","args":{"value":{"@path":"/notes"}}}',
    ])
    expect(
      errorsAfter((m) => {
        componentOf(m, 'notes')['@checks'] = [
          { condition: { '@call': 'required', args: { value: { '@path': '/audience' } } } },
        ]
      }),
    ).toEqual([
      'components[4].@checks[0].condition: must be {"@call":"required","args":{"value":{"@path":"/notes"}}}',
    ])
    expect(
      errorsAfter((m) => {
        componentOf(m, 'notes')['@checks'] = [{ condition: { '@path': '/notes' } }]
      }),
    ).toEqual([
      'components[4].@checks[0].condition: must be {"@call":"required","args":{"value":{"@path":"/notes"}}}',
    ])
    expect(
      errorsAfter((m) => {
        componentOf(m, 'notes')['@checks'] = [
          {
            condition: { '@call': 'required', args: { value: { '@path': '/notes' } } },
            severity: 'warning',
          },
        ]
      }),
    ).toEqual(['components[4].@checks[0].severity: unknown property'])
    expect(
      errorsAfter((m) => {
        componentOf(m, 'notes')['@checks'] = { condition: {} }
      }),
    ).toEqual(['components[4].@checks: must be a list'])
    // the message is accepted and not used
    const message = specExample()
    ;(componentOf(message, 'audience')['@checks'] as Record<string, unknown>[])[0]!.message =
      'Please pick'
    expect(viewOf(message).inputs[0]!.required).toBe(true)
  })

  it('rejects the obscured TextField and checks variants', () => {
    expect(errorsAfter((m) => (componentOf(m, 'notes').variant = 'obscured'))).toEqual([
      'components[4].variant: "obscured" is not accepted',
    ])
    expect(errorsAfter((m) => (componentOf(m, 'audience').variant = 'single'))).toEqual([
      'components[2].variant: must be one of mutuallyExclusive, multipleSelection',
    ])
  })

  it('checks Slider numbers', () => {
    expect(errorsAfter((m) => delete componentOf(m, 'length').max)).toEqual([
      'components[3].max: is required',
    ])
    expect(errorsAfter((m) => (componentOf(m, 'length').max = 5))).toContain(
      'components[3].max: must be greater than min',
    )
    expect(errorsAfter((m) => (componentOf(m, 'length').steps = 0))).toEqual([
      'components[3].steps: must be an integer of 1 or more',
    ])
    expect(errorsAfter((m) => (componentOf(m, 'length').steps = 2.5))).toEqual([
      'components[3].steps: must be an integer of 1 or more',
    ])
    expect(errorsAfter((m) => (componentOf(m, 'length').min = '5'))).toEqual([
      'components[3].min: must be a number',
    ])
  })

  it('checks @accessibility', () => {
    expect(errorsAfter((m) => (componentOf(m, 'notes')['@accessibility'] = 'Notes'))).toEqual([
      'components[4].@accessibility: must be an object',
    ])
  })

  it('checks the data model', () => {
    expect(errorsAfter((m) => (surfaceOf(m).dataModel = []))).toEqual([
      'dataModel: must be an object',
    ])
    expect(errorsAfter((m) => (surfaceOf(m).dataModel = { audience: [], other: 1 }))).toEqual([
      'dataModel.other: not the id of an input component',
    ])
    expect(errorsAfter((m) => (surfaceOf(m).dataModel = { title: 'x' }))).toEqual([
      'dataModel.title: not the id of an input component',
    ])
    expect(errorsAfter((m) => (surfaceOf(m).dataModel = { audience: 'parents' }))).toEqual([
      'dataModel.audience: must be a list of option values',
    ])
    expect(errorsAfter((m) => (surfaceOf(m).dataModel = { audience: ['kids'] }))).toEqual([
      'dataModel.audience[0]: "kids" is not an option value',
    ])
    expect(
      errorsAfter((m) => (surfaceOf(m).dataModel = { audience: ['parents', 'teachers'] })),
    ).toEqual(['dataModel.audience: a mutuallyExclusive picker holds at most one value'])
    expect(
      errorsAfter((m) => {
        componentOf(m, 'audience').variant = 'multipleSelection'
        surfaceOf(m).dataModel = { audience: ['parents', 'parents'] }
      }),
    ).toEqual(['dataModel.audience[1]: "parents" is listed more than once'])
    expect(errorsAfter((m) => (surfaceOf(m).dataModel = { length: 30 }))).toEqual([
      'dataModel.length: must be a number from 5 to 20',
    ])
    expect(errorsAfter((m) => (surfaceOf(m).dataModel = { length: '10' }))).toEqual([
      'dataModel.length: must be a number from 5 to 20',
    ])
    expect(errorsAfter((m) => (surfaceOf(m).dataModel = { notes: 5 }))).toEqual([
      'dataModel.notes: must be a string',
    ])
    const checkbox = everyPropertyExample()
    surfaceOf(checkbox).dataModel = { agree: 'yes' }
    expect(errorsOf(checkbox)).toEqual(['dataModel.agree: must be true or false'])
    const numberField = everyPropertyExample()
    surfaceOf(numberField).dataModel = { count: Number.POSITIVE_INFINITY }
    expect(errorsOf(numberField)).toEqual(['dataModel.count: must be a string'])
  })
})

describe('submitAction and skipAction', () => {
  const now = new Date('2026-11-24T09:00:00.000Z')

  it('builds the spec 3.3 submit message', () => {
    const view = viewOf(specExample())
    const message = submitAction(view, { length: 12, notes: '사진을 많이' }, ['audience'], now)
    expect(message).toEqual({
      version: '1.0',
      action: {
        name: 'submit',
        surfaceId: 'deck-scope',
        sourceComponentId: QUESTION_SUBMIT_COMPONENT_ID,
        timestamp: '2026-11-24T09:00:00.000Z',
        context: {
          answers: { length: 12, notes: '사진을 많이' },
          decideForMe: ['audience'],
        },
      },
    })
    expect(QUESTION_SUBMIT_COMPONENT_ID).toBe('ieum_submit')
  })

  it('includes every input not left to the AI, untouched ones with their current value', () => {
    const view = viewOf(everyPropertyExample())
    const message = submitAction(view, { name: 'Report' }, [], now)
    expect(message.action.context).toEqual({
      answers: { pick: ['a', 'c'], agree: true, count: '12', name: 'Report', level: 2 },
      decideForMe: [],
    })
    expect(Object.keys(message.action.context.answers)).toEqual([
      'pick',
      'agree',
      'count',
      'name',
      'level',
    ])
  })

  it('keeps empty values and drops answers that do not fit the input', () => {
    const view = viewOf(specExample())
    const message = submitAction(
      view,
      { audience: ['parents', 'kids'], length: 99, notes: 7, stray: 'x' },
      [],
      now,
    )
    expect(message.action.context.answers).toEqual({ audience: ['parents'], length: 20, notes: '' })
  })

  it('lists decide-for-me only for pickers of this card, in screen order', () => {
    const view = viewOf(everyPropertyExample())
    const message = submitAction(view, {}, ['agree', 'pick', 'pick', 'nope'], now)
    expect(message.action.context.decideForMe).toEqual(['pick'])
    expect(message.action.context.answers).not.toHaveProperty('pick')
    expect(message.action.context.answers).toHaveProperty('agree', true)
  })

  it('builds the skip message', () => {
    const view = viewOf(specExample())
    expect(skipAction(view, now)).toEqual({
      version: '1.0',
      action: {
        name: 'skip',
        surfaceId: 'deck-scope',
        sourceComponentId: QUESTION_SKIP_COMPONENT_ID,
        timestamp: '2026-11-24T09:00:00.000Z',
        context: {},
      },
    })
    expect(QUESTION_SKIP_COMPONENT_ID).toBe('ieum_skip')
  })

  it('does not throw on an invalid date', () => {
    const view = viewOf(specExample())
    expect(() => skipAction(view, new Date(Number.NaN))).not.toThrow()
    expect(skipAction(view, new Date(Number.NaN)).action.timestamp).toMatch(/^\d{4}-\d\d-\d\dT/)
  })
})

describe('package exports', () => {
  it('exports the question card contract from the package entry', () => {
    expect(index.validateQuestionSurface).toBe(validateQuestionSurface)
    expect(index.submitAction).toBe(submitAction)
    expect(index.skipAction).toBe(skipAction)
    expect(index.QUESTION_CARD_CATALOG_ID).toBe('ieumoffice.com:question-card/v1')
    expect(typeof index.readQuestionRecord).toBe('function')
    expect(typeof index.parseQuestionAction).toBe('function')
  })
})
