// The PDF skill's optional surface argument (mobile PDF editor, track T2 PDF-T12):
// without it the desktop prompt, tools and context are exactly what they were before
// the argument existed; with `surface: 'mobile'` only the phone's tools are offered and
// the prompt describes just those.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createPdfSkill, MOBILE_PDF_TOOLS } from '../src/renderer/ai/pdf-skill'
import { AGENT_TOOLS, ENCRYPTED_CONTEXT } from '../src/renderer/ai/tools'
import type { PdfAiDeps } from '../src/renderer/ai/tools'

function makeDeps(over: Partial<PdfAiDeps> = {}): PdfAiDeps {
  const stub = new Proxy(
    {
      fileName: () => 'doc.pdf',
      pageCount: () => 3,
      currentPage: () => 2,
      readOnly: () => false,
      ocrText: () => null,
      selection: () => ({ page: 1, lastPage: 2, text: 'chosen words' }),
      pendingSummary: () => 'Unsaved changes queued this session: markups: 1.',
      annotationSummary: () =>
        'The document has 1 note thread(s); use read_annotations to read them.',
      metadata: () => ({ title: 'Plan', author: 'Kim' }),
      outline: () => [{ title: 'One', dest: null, items: [] }],
      // absent like the desktop app before a route is known
      imageGenAvailable: undefined,
      ...over,
    } as Record<string, unknown>,
    {
      get(target, prop: string) {
        if (prop in target) return target[prop]
        return () => {
          throw new Error(`unexpected deps call: ${prop}`)
        }
      },
    },
  )
  return stub as unknown as PdfAiDeps
}

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

// sha256 of the desktop prompt and context as they were before the optional argument
// was added (taken from the unchanged pdf-skill.ts); any change here is a PC change
const DESKTOP = {
  prompt: 'b913ae60797ffb083230d5fd2c1c1c43616dce231d203bd9070ae89abb6e7566',
  promptImageOff: '47e1c79e29a4fca356192cc029799843f115021d443409ff636c0fd4271dd281',
  context: '16e2c1e3e866f029d204020bd865c1ad3985384aa1c5ea03b3fea180fbd53c03',
  contextReadOnly: 'fd5b06dda9a9980f725f1726ab68258dbc98f4c7a7192dd313c5e367858ac75d',
}

describe('pdf skill: desktop default unchanged', () => {
  it('keeps the prompt byte for byte', () => {
    expect(sha(createPdfSkill(makeDeps()).systemPrompt)).toBe(DESKTOP.prompt)
    expect(sha(createPdfSkill(makeDeps({ imageGenAvailable: () => true })).systemPrompt)).toBe(
      DESKTOP.prompt,
    )
    expect(sha(createPdfSkill(makeDeps({ imageGenAvailable: () => false })).systemPrompt)).toBe(
      DESKTOP.promptImageOff,
    )
    // an empty options object is the default too
    expect(sha(createPdfSkill(makeDeps(), {}).systemPrompt)).toBe(DESKTOP.prompt)
    expect(sha(createPdfSkill(makeDeps(), { surface: 'desktop' }).systemPrompt)).toBe(
      DESKTOP.prompt,
    )
  })

  it('keeps the per-message context byte for byte', () => {
    expect(sha(createPdfSkill(makeDeps()).buildContext!())).toBe(DESKTOP.context)
    expect(sha(createPdfSkill(makeDeps({ readOnly: () => true })).buildContext!())).toBe(
      DESKTOP.contextReadOnly,
    )
  })

  it('keeps every tool', () => {
    expect(createPdfSkill(makeDeps()).tools).toBe(AGENT_TOOLS)
    expect(createPdfSkill(makeDeps(), {}).tools).toBe(AGENT_TOOLS)
  })
})

describe('pdf skill: mobile surface', () => {
  const mobile = (over: Partial<PdfAiDeps> = {}) =>
    createPdfSkill(makeDeps({ imageGenAvailable: () => false, ...over }), { surface: 'mobile' })

  it('offers exactly the phone tools, in the desktop order', () => {
    const names = mobile().tools.map((t) => t.name)
    expect([...names].sort()).toEqual([...MOBILE_PDF_TOOLS].sort())
    expect(names).toEqual(AGENT_TOOLS.map((t) => t.name).filter((n) => names.includes(n)))
  })

  it('describes only those tools and the phone rules', () => {
    const prompt = mobile().systemPrompt
    for (const gone of [
      'insert_text',
      'edit_text',
      'edit_block',
      'insert_image',
      'image_search',
      'generate_image',
      'web_search',
      'read_url',
      'create_document',
      'start_document_translation',
      'start_ai_page_reading',
      'set_watermark',
      'set_page_size',
      'addFormField',
      'setMetadata',
      'pdfnav://',
      '⌘',
    ]) {
      expect(prompt, gone).not.toContain(gone)
    }
    for (const tool of MOBILE_PDF_TOOLS) expect(prompt, tool).toContain(tool)
    expect(prompt).toContain('setFormValue')
    expect(prompt).toContain('add_form_mark')
    expect(prompt).toMatch(/"page N"/)
  })

  it('does not point at document properties it cannot change', () => {
    const ctx = mobile().buildContext!()
    expect(ctx).toContain('Document properties: title "Plan", author "Kim"')
    expect(ctx).not.toContain('setMetadata')
    expect(ctx).toContain('chosen words')
  })

  it('keeps the desktop encrypted-document rule without the tools the phone lacks', () => {
    const ctx = mobile({ readOnly: () => true }).buildContext!()
    expect(ctx).not.toContain(ENCRYPTED_CONTEXT)
    expect(ctx).toContain('read-only')
    expect(ctx).toContain('Do not refuse those because of the encryption')
    expect(ctx).not.toContain('start_document_translation')
  })
})
