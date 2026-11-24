/** Shared A2UI question-card messages for the question-card tests. */

/** The example of the spec (section 3.1), verbatim. */
export function specExample(): Record<string, unknown> {
  return {
    version: '1.0',
    createSurface: {
      surfaceId: 'deck-scope',
      catalogId: 'ieumoffice.com:question-card/v1',
      components: [
        { id: 'root', component: 'Column', children: ['title', 'audience', 'length', 'notes'] },
        { id: 'title', component: 'Text', text: '발표 자료 방향을 정해 주세요' },
        {
          id: 'audience',
          component: 'ChoicePicker',
          label: '누가 듣나요?',
          variant: 'mutuallyExclusive',
          options: [
            { label: '학부모', value: 'parents' },
            { label: '동료 교사', value: 'teachers' },
          ],
          value: { '@path': '/audience' },
          '@checks': [
            { condition: { '@call': 'required', args: { value: { '@path': '/audience' } } } },
          ],
        },
        {
          id: 'length',
          component: 'Slider',
          label: '장 수',
          min: 5,
          max: 20,
          steps: 15,
          value: { '@path': '/length' },
        },
        {
          id: 'notes',
          component: 'TextField',
          label: '그 밖에 바라는 점',
          variant: 'longText',
          value: { '@path': '/notes' },
        },
      ],
      dataModel: { audience: [], length: 10, notes: '' },
    },
  }
}

/** A message that uses every accepted property, including the accepted-but-unused ones. */
export function everyPropertyExample(): Record<string, unknown> {
  return {
    version: '1.0',
    createSurface: {
      surfaceId: 'all_props',
      sendDataModel: false,
      metadata: { extensions: { com_example_tag: 'x' } },
      components: [
        {
          id: 'root',
          component: 'Column',
          children: [
            'title',
            'intro',
            'pick',
            'agree_hint',
            'agree',
            'count',
            'name',
            'level',
            'tail',
          ],
          justify: 'start',
          align: 'stretch',
          '@accessibility': { label: 'Questions', live: 'polite' },
          '@metadata': { extensions: { com_example_trace: 1 } },
        },
        { id: 'title', component: 'Text', text: 'Pick a direction', variant: 'body', weight: 1 },
        { id: 'intro', component: 'Text', text: 'Two quick questions.', variant: 'caption' },
        {
          id: 'pick',
          component: 'ChoicePicker',
          label: 'Topics',
          variant: 'multipleSelection',
          options: [
            { label: 'Alpha', value: 'a' },
            { label: 'Beta', value: 'b' },
            { label: 'Gamma', value: 'c' },
          ],
          value: { '@path': '/pick' },
          displayStyle: 'chips',
          filterable: false,
          weight: 2,
          '@accessibility': { label: 'Topic list', description: 'pick topics' },
          '@checks': [
            {
              condition: { '@call': 'required', args: { value: { '@path': '/pick' } } },
              message: 'Pick one',
            },
          ],
        },
        { id: 'agree_hint', component: 'Text', text: 'Tick if needed.' },
        {
          id: 'agree',
          component: 'CheckBox',
          label: 'Include a summary',
          value: { '@path': '/agree' },
        },
        {
          id: 'count',
          component: 'TextField',
          label: 'How many pages?',
          variant: 'number',
          placeholder: 'e.g. 10',
          value: { '@path': '/count' },
        },
        { id: 'name', component: 'TextField', label: 'Title', value: { '@path': '/name' } },
        {
          id: 'level',
          component: 'Slider',
          label: 'Detail',
          max: 3,
          value: { '@path': '/level' },
        },
        { id: 'tail', component: 'Text', text: 'Thanks.' },
      ],
      dataModel: { pick: ['a', 'c'], agree: true, count: 12, level: 2 },
    },
  }
}

/** Deep copy helper so each test mutates its own message. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** The `createSurface` body of a message. */
export function surfaceOf(message: Record<string, unknown>): Record<string, unknown> {
  return message.createSurface as Record<string, unknown>
}

/** The component with `id` in a message. */
export function componentOf(message: Record<string, unknown>, id: string): Record<string, unknown> {
  const components = surfaceOf(message).components as Record<string, unknown>[]
  const found = components.find((c) => c.id === id)
  if (!found) throw new Error(`no component ${id}`)
  return found
}
