import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { HwpDocument, initSync } from '@rhwp/core'
import { buildFlowHtml } from '../src/renderer/editors/hwpFlow'
import type { FlowEngineDocument } from '../src/renderer/editors/rhwpEngine'

// The sample documents the app ships and opens read-only from the home screen (spec 3.16).
const require = createRequire(import.meta.url)
const samples = join(__dirname, '../src-tauri/src/storage/samples')

beforeAll(() => {
  const wasm = readFileSync(join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm'))
  initSync({ module: wasm })
})

interface SampleCase {
  readonly file: string
  readonly title: string
  readonly items: readonly string[]
  readonly cells: readonly string[]
  readonly closing: string
}

const cases: readonly SampleCase[] = [
  {
    file: 'welcome-ko.hwpx',
    title: '이음오피스 시작하기',
    items: [
      '글을 고치려면 [편집]을 누르세요.',
      '문서는 종이 쪽 모양 그대로 열립니다.',
      '공유를 누르면 문서를 다른 앱으로 보낼 수 있습니다.',
      '[완료]를 누르면 원본에 씁니다.',
    ],
    cells: ['하고 싶은 일', '글 고치기', '보기 도구의 읽기 화면', '공유'],
    closing: '[사본으로 편집]',
  },
  {
    file: 'welcome-en.hwpx',
    title: 'Getting started with IeumOffice',
    items: [
      'To change the text, tap [Edit].',
      'Documents open in the printed page layout.',
      'Tap share to send the document to another app.',
      'it writes the original when you tap [Done].',
    ],
    cells: ['What you want to do', 'Change the text', 'Reading view in the view tools', 'Share'],
    closing: '[Edit a copy]',
  },
]

function openSample(file: string): HwpDocument {
  return new HwpDocument(new Uint8Array(readFileSync(join(samples, file))))
}

function paragraphTexts(doc: HwpDocument): string[] {
  const texts: string[] = []
  for (let p = 0; p < doc.getParagraphCount(0); p++) {
    texts.push(doc.getTextRange(0, p, 0, doc.getParagraphLength(0, p)))
  }
  return texts
}

describe.each(cases)('home sample $file (real rhwp engine)', (sample) => {
  it('opens as a one-page document with the title, the list items and a table', () => {
    const doc = openSample(sample.file)
    try {
      expect(doc.pageCount()).toBe(1)
      const texts = paragraphTexts(doc)
      expect(texts[0]).toBe(sample.title)
      for (const item of sample.items) {
        expect(texts.some((text) => text.includes(item))).toBe(true)
      }
      expect(texts.some((text) => text.includes(sample.closing))).toBe(true)
      const controls = JSON.parse(doc.getControls()) as { ctrlId: string }[]
      expect(controls.some((control) => control.ctrlId === 'tbl')).toBe(true)
    } finally {
      doc.free()
    }
  })

  it('shows the title, a real bullet list and the table in the flow view', () => {
    const doc = openSample(sample.file)
    let html: string
    try {
      html = buildFlowHtml(doc as unknown as FlowEngineDocument)
    } finally {
      doc.free()
    }
    const body = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body
    expect(body.querySelector('.flow-p')?.textContent).toContain(sample.title)
    // list items are bullet paragraphs (marker drawn outside the text), not typed bullets
    const bullets = [...body.querySelectorAll('.flow-p p[data-marker]')]
    expect(bullets).toHaveLength(sample.items.length)
    for (const [i, item] of sample.items.entries()) {
      expect(bullets[i].textContent).toContain(item)
      expect(bullets[i].textContent?.startsWith('•')).toBe(false)
    }
    const table = body.querySelector('table')
    expect(table).not.toBeNull()
    expect(table?.querySelectorAll('tr')).toHaveLength(4)
    for (const cell of sample.cells) expect(table?.textContent).toContain(cell)
  })
})
