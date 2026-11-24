import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { HwpDocument, initSync } from '@rhwp/core'
import { PageNumberSheet } from '../src/renderer/components/PageNumberSheet'
import {
  applyPageNumber,
  readPageNumber,
  type PageNumberDocument,
} from '../src/renderer/editors/pageNumbers'
import { MobileLocaleProvider } from '../src/renderer/i18n'

const require = createRequire(import.meta.url)
const fixtures = join(__dirname, '../../hwp/tests/fixtures')

beforeAll(() => {
  initSync({ module: readFileSync(join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')) })
})

const open = (name: string) => new HwpDocument(new Uint8Array(readFileSync(join(fixtures, name))))
const asDoc = (doc: HwpDocument) => doc as unknown as PageNumberDocument

describe('page numbers (real rhwp engine)', () => {
  it('reads the document page number', () => {
    const numbered = open('page-number-pages.hwpx')
    const plain = open('nested-form.hwp')
    try {
      expect(readPageNumber(asDoc(numbered))).toEqual({
        place: 'bottomCenter',
        shape: 'digit',
        dash: true,
      })
      expect(readPageNumber(asDoc(plain))?.place).toBe('none')
    } finally {
      numbered.free()
      plain.free()
    }
  })

  it('numbers the pages, changes the number and takes it away, and the file keeps it', () => {
    const doc = open('nested-form.hwp')
    try {
      applyPageNumber(asDoc(doc), { place: 'bottomRight', shape: 'upperRoman', dash: false })
      const reopened = new HwpDocument(doc.exportHwp())
      try {
        expect(readPageNumber(asDoc(reopened))).toEqual({
          place: 'bottomRight',
          shape: 'upperRoman',
          dash: false,
        })
      } finally {
        reopened.free()
      }
      applyPageNumber(asDoc(doc), { place: 'none', shape: 'digit', dash: true })
      expect(readPageNumber(asDoc(doc))?.place).toBe('none')
    } finally {
      doc.free()
    }
  })

  it('leaves later sections without their own page number alone', () => {
    const calls: number[] = []
    const fake: PageNumberDocument = {
      getSectionCount: () => 3,
      getPageNumberPos: (sec) =>
        JSON.stringify({ ok: true, pageNumber: sec === 2 ? { format: 0, position: 5 } : null }),
      setPageNumberPos: (sec) => {
        calls.push(sec)
        return '{"ok":true}'
      },
    }
    applyPageNumber(fake, { place: 'topCenter', shape: 'digit', dash: true })
    expect(calls).toEqual([0, 2])
  })
})

describe('PageNumberSheet', () => {
  const containers: HTMLElement[] = []
  afterEach(() => {
    while (containers.length > 0) containers.pop()?.remove()
  })

  it('starts from the current setting and applies the chosen one', () => {
    const onApply = vi.fn()
    const el = document.createElement('div')
    document.body.appendChild(el)
    containers.push(el)
    act(() =>
      createRoot(el).render(
        <MobileLocaleProvider lang="ko">
          <PageNumberSheet
            open
            onClose={() => {}}
            current={{ place: 'none', shape: 'digit', dash: true }}
            onApply={onApply}
          />
        </MobileLocaleProvider>,
      ),
    )
    const radios = () => [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
    // nothing numbered yet: only the places are offered
    expect(radios()).toHaveLength(5)
    act(() =>
      radios()
        .find((b) => b.textContent === '위 가운데')!
        .click(),
    )
    // a place is chosen: the shapes and the dash switch appear
    expect(radios()).toHaveLength(9)
    act(() =>
      radios()
        .find((b) => b.textContent === 'i, ii, iii')!
        .click(),
    )
    act(() =>
      document.querySelector<HTMLButtonElement>('[data-testid="hwp-page-number-apply"]')!.click(),
    )
    expect(onApply).toHaveBeenCalledWith({ place: 'topCenter', shape: 'lowerRoman', dash: true })
  })
})
