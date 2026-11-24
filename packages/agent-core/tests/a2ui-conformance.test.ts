/**
 * Checks the question card contract against the official A2UI v1.0 JSON schemas
 * (copied into tests/fixtures/a2ui-v1_0, see its README). The app itself never
 * validates with these schemas; the tests prove that what it accepts and returns
 * is real A2UI.
 */
import { readFileSync } from 'node:fs'
import { Ajv2020 } from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import {
  QUESTION_CARD_CATALOG_ID,
  QUESTION_CARD_COMPONENT_PROPS,
  skipAction,
  submitAction,
  validateQuestionSurface,
} from '../src/a2ui-question-card'
import { clone, everyPropertyExample, specExample, surfaceOf } from './question-card-fixtures'

type Json = Record<string, unknown>

function fixture(name: string): Json {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/a2ui-v1_0/${name}`, import.meta.url), 'utf8'),
  ) as Json
}

function ownCatalog(): Json {
  return JSON.parse(
    readFileSync(new URL('../src/question-card-catalog.json', import.meta.url), 'utf8'),
  ) as Json
}

// `agent_to_renderer.json` and `common_types.json` refer to the active catalog as
// `catalog.json` next to them; the basic catalog's own `$id` does not resolve that,
// so the catalog is registered under that address (as A2UI's own tests do).
const ACTIVE_CATALOG_ID = 'https://a2ui.org/specification/v1_0/catalog.json'

function validatorsWith(catalog: Json) {
  const ajv = new Ajv2020({ strict: false, allErrors: true })
  addFormats(ajv)
  ajv.addSchema(fixture('common_types.json'))
  ajv.addSchema({ ...catalog, $id: ACTIVE_CATALOG_ID })
  return {
    agentToRenderer: ajv.compile(fixture('agent_to_renderer.json')),
    rendererToAgent: ajv.compile(fixture('renderer_to_agent.json')),
  }
}

const basic = validatorsWith(fixture('basic_catalog_v1.json'))
const own = validatorsWith(ownCatalog())

/** Valid test messages beyond the spec example. */
function validCases(): Json[] {
  const noDataModel = everyPropertyExample()
  delete surfaceOf(noDataModel).dataModel
  const noCatalogId = specExample()
  delete surfaceOf(noCatalogId).catalogId
  const checkbox = {
    version: '1.0',
    createSurface: {
      surfaceId: 'one',
      components: [
        { id: 'root', component: 'Column', children: ['ok'] },
        { id: 'ok', component: 'CheckBox', label: 'OK?', value: { '@path': '/ok' } },
      ],
      dataModel: { ok: false },
    },
  }
  return [specExample(), everyPropertyExample(), noDataModel, noCatalogId, checkbox]
}

describe('A2UI v1.0 conformance', () => {
  it('the spec example and the valid cases pass the validator and the official schema', () => {
    for (const message of validCases()) {
      expect(validateQuestionSurface(clone(message)).ok).toBe(true)
      const passesBasic = basic.agentToRenderer(message)
      expect(basic.agentToRenderer.errors ?? []).toEqual([])
      expect(passesBasic).toBe(true)
      const passesOwn = own.agentToRenderer(message)
      expect(own.agentToRenderer.errors ?? []).toEqual([])
      expect(passesOwn).toBe(true)
    }
  })

  it('the action messages pass renderer_to_agent.json', () => {
    const now = new Date('2026-11-24T09:00:00.000Z')
    for (const message of validCases()) {
      const result = validateQuestionSurface(message)
      if (!result.ok) throw new Error(result.errors.join('\n'))
      const view = result.view
      const firstPicker = view.inputs.find((i) => i.kind === 'ChoicePicker')
      const outputs = [
        submitAction(view, {}, [], now),
        submitAction(view, {}, firstPicker ? [firstPicker.id] : [], now),
        skipAction(view, now),
      ]
      for (const output of outputs) {
        const wire = JSON.parse(JSON.stringify(output)) as unknown
        const passes = basic.rendererToAgent(wire)
        expect(basic.rendererToAgent.errors ?? []).toEqual([])
        expect(passes).toBe(true)
      }
    }
  })

  it('the official schema also rejects what the validator rejects for shape reasons', () => {
    const unknownProp = specExample()
    ;((surfaceOf(unknownProp).components as Json[])[4] as Json).maxLength = 3
    expect(basic.agentToRenderer(unknownProp)).toBe(false)
    expect(validateQuestionSurface(unknownProp).ok).toBe(false)
  })
})

describe('question card catalog file', () => {
  const catalog = ownCatalog()
  const basicCatalog = fixture('basic_catalog_v1.json')
  const NAMES = ['Column', 'Text', 'ChoicePicker', 'CheckBox', 'TextField', 'Slider']

  it('follows catalog_definition.json', () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true })
    addFormats(ajv)
    ajv.addSchema(fixture('common_types.json'))
    const validate = ajv.compile(fixture('catalog_definition.json'))
    const passes = validate(catalog)
    expect(validate.errors ?? []).toEqual([])
    expect(passes).toBe(true)
  })

  it('has the catalog id and the six components and one function of the basic catalog, unchanged', () => {
    expect(catalog.catalogId).toBe(QUESTION_CARD_CATALOG_ID)
    expect(catalog.$id).toBe(QUESTION_CARD_CATALOG_ID)
    expect(catalog.protocolVersion).toBe('1.0')
    const components = catalog.components as Json
    expect(Object.keys(components).sort()).toEqual([...NAMES].sort())
    for (const name of NAMES) {
      expect(components[name]).toEqual((basicCatalog.components as Json)[name])
    }
    expect(Object.keys(catalog.functions as Json)).toEqual(['required'])
    expect((catalog.functions as Json).required).toEqual((basicCatalog.functions as Json).required)
    expect((catalog.$defs as Json).Weight).toEqual((basicCatalog.$defs as Json).Weight)
  })

  it('names its source and license in the description', () => {
    const description = String(catalog.description)
    expect(description).toContain('https://github.com/a2ui-project/a2ui')
    expect(description).toContain('c26be2dd087b541c46e0296c164ae13bf35f7836')
    expect(description).toContain('Apache License, Version 2.0')
  })

  it('defines exactly the properties the validator accepts', () => {
    const common = fixture('common_types.json')
    const defs = common.$defs as Json
    const envelope = Object.keys((defs.ComponentCommon as Json).properties as Json)
    const checkable = Object.keys((defs.Checkable as Json).properties as Json)
    const components = catalog.components as Json
    for (const name of NAMES) {
      const definition = components[name] as Json
      const parts = [definition, ...(((definition.allOf as Json[]) ?? []) as Json[])]
      const props = new Set<string>()
      for (const part of parts) {
        if (part.$ref === 'common_types.json#/$defs/Checkable')
          checkable.forEach((p) => props.add(p))
        for (const key of Object.keys((part.properties as Json) ?? {})) props.add(key)
      }
      props.delete('component')
      // envelope properties every component may carry; @catalogId is refused on purpose
      for (const key of envelope) if (key !== 'id' && key !== '@catalogId') props.add(key)
      const accepted =
        QUESTION_CARD_COMPONENT_PROPS[name as keyof typeof QUESTION_CARD_COMPONENT_PROPS]
      expect([...accepted].sort(), name).toEqual([...props].sort())
    }
  })
})
