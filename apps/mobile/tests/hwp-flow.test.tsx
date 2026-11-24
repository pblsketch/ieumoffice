import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { HwpDocument, initSync } from '@rhwp/core'
import {
  buildFlowDocument,
  buildFlowHtml,
  stripClipboardFragment,
} from '../src/renderer/editors/hwpFlow'
import { HwpFlowView } from '../src/renderer/editors/HwpFlowView'
import type { FlowEngineDocument } from '../src/renderer/editors/rhwpEngine'

const require = createRequire(import.meta.url)
const fixtures = join(__dirname, '../../hwp/tests/fixtures')

beforeAll(() => {
  const wasm = readFileSync(join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm'))
  initSync({ module: wasm })
})

const containers: HTMLElement[] = []
afterEach(() => {
  while (containers.length > 0) containers.pop()?.remove()
})

describe('HWP flow builder (real rhwp engine)', () => {
  it('rebuilds a form with nested tables as tagged paragraphs and objects', () => {
    const doc = new HwpDocument(new Uint8Array(readFileSync(join(fixtures, 'nested-form.hwp'))))
    try {
      const html = buildFlowHtml(doc as unknown as FlowEngineDocument)
      expect(html).toContain('class="flow-p" data-sec="0" data-para="0"')
      expect(html).toContain('교과협의록')
      expect(html).toMatch(/class="flow-obj" data-sec="0" data-para="\d+" data-ctrl="0"/)
      expect((html.match(/<table/g) ?? []).length).toBeGreaterThanOrEqual(2)
      expect(html).not.toContain('StartFragment')
    } finally {
      doc.free()
    }
  })

  it('keeps pictures', () => {
    const doc = new HwpDocument(
      new Uint8Array(readFileSync(join(fixtures, 'square-picture-after-page-reset.hwpx'))),
    )
    try {
      expect(buildFlowHtml(doc as unknown as FlowEngineDocument)).toContain('<img')
    } finally {
      doc.free()
    }
  })

  it('strips the clipboard wrapper and builds a script-free frame document', () => {
    expect(
      stripClipboardFragment('<html><!--StartFragment--><p>a</p><!--EndFragment--></html>'),
    ).toBe('<p>a</p>')
    const page = buildFlowDocument('<div class="flow-p">x</div>', 1.3, 'ko')
    expect(page).toContain('--flow-zoom:1.3')
    expect(page).not.toContain('<script')
  })
})

describe('HwpFlowView', () => {
  function render(node: React.ReactNode): HTMLElement {
    const el = document.createElement('div')
    document.body.appendChild(el)
    containers.push(el)
    act(() => createRoot(el).render(node))
    return el
  }

  it('shows the flow in a frame that cannot run scripts', async () => {
    const fake: FlowEngineDocument = {
      getSectionCount: () => 1,
      getParagraphCount: () => 1,
      getParagraphLength: () => 3,
      getControlTextPositions: () => '[]',
      exportSelectionHtml: () => '<!--StartFragment--><p>본문</p><!--EndFragment-->',
      exportControlHtml: () => '',
      free: vi.fn(),
    }
    const el = render(
      <HwpFlowView
        bytes={new Uint8Array([1])}
        title="문서.hwp"
        lang="ko"
        zoom={1.2}
        openDocument={async () => fake}
      />,
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    const frame = el.querySelector('iframe')
    expect(frame?.getAttribute('sandbox')).toBe('allow-same-origin')
    expect(frame?.getAttribute('srcdoc')).toContain('<p>본문</p>')
    // the engine document stays open while the view is shown (for editing)
    expect(fake.free).not.toHaveBeenCalled()
  })

  it('reports when the engine cannot open the document', async () => {
    const onUnavailable = vi.fn()
    render(
      <HwpFlowView
        bytes={new Uint8Array([1])}
        title="잠긴.hwp"
        lang="ko"
        zoom={1.2}
        openDocument={async () => {
          throw new Error('password')
        }}
        onUnavailable={onUnavailable}
      />,
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(onUnavailable).toHaveBeenCalledWith('password')
  })
})
