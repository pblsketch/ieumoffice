import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { attachPinchZoom, computePinchScale } from '../src/renderer/editors/pinchZoom'
import { buildFlowDocument } from '../src/renderer/editors/hwpFlow'
import { readStudioZoom, studioZoomPercentToSlider } from '../src/renderer/editors/HwpMobileEditor'
import { MarkdownMobileEditor } from '../src/renderer/editors/MarkdownMobileEditor'
import { HtmlPreviewFrame } from '../src/renderer/editors/html/HtmlPreviewFrame'
import { FONT_SCALES, nearestFontScale } from '../src/renderer/editors/readers/epub/epubView'
import { MOBILE_DICTS, translateMobile } from '../src/renderer/i18n'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const here = dirname(fileURLToPath(import.meta.url))
const roots: Root[] = []
const containers: HTMLElement[] = []

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  for (const container of containers.splice(0)) container.remove()
})

function fakeTouchEvent(type: string, points: [number, number][]): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  const touches = points.map(([clientX, clientY]) => ({ clientX, clientY }))
  Object.defineProperty(event, 'touches', { value: touches })
  return event
}

describe('document-only pinch zoom and viewport lock', () => {
  it('locks the app viewport in index.html and HWP flow frame so chrome never scales', () => {
    const html = readFileSync(join(here, '../src/renderer/index.html'), 'utf8')
    expect(html).toContain('maximum-scale=1.0')
    expect(html).toContain('user-scalable=no')

    const flowDoc = buildFlowDocument('<p>hello</p>', 1.2, 'ko')
    expect(flowDoc).toContain('maximum-scale=1,user-scalable=no')
    expect(flowDoc).toContain('touch-action: pan-x pan-y')
  })

  it('computes clamped pinch scales cleanly', () => {
    expect(computePinchScale(1, 100, 200, 0.5, 3)).toBe(2)
    expect(computePinchScale(1, 100, 500, 0.5, 2.4)).toBe(2.4)
    expect(computePinchScale(1, 100, 10, 0.8, 2.4)).toBe(0.8)
    expect(computePinchScale(1.2, 0, 200, 0.8, 2.4)).toBe(1.2)
  })

  it('attaches two-finger pinch listeners and commits the new scale on touchend', () => {
    const el = document.createElement('div')
    let current = 1
    const preview = vi.fn()
    const commit = vi.fn((next: number) => {
      current = next
    })
    const dispose = attachPinchZoom(el, {
      getScale: () => current,
      min: 0.8,
      max: 2.4,
      onPreview: preview,
      onCommit: commit,
    })

    el.dispatchEvent(
      fakeTouchEvent('touchstart', [
        [0, 0],
        [100, 0],
      ]),
    )
    const move = fakeTouchEvent('touchmove', [
      [0, 0],
      [150, 0],
    ])
    el.dispatchEvent(move)
    expect(move.defaultPrevented).toBe(true)
    el.dispatchEvent(fakeTouchEvent('touchend', []))

    expect(commit).toHaveBeenCalledWith(1.5)
    expect(current).toBe(1.5)
    dispose()
  })

  it('maps rhwp-studio zoom percentages to its logarithmic slider range and reads aria-valuetext', () => {
    expect(studioZoomPercentToSlider(10)).toBe(0)
    expect(studioZoomPercentToSlider(100)).toBe(500)
    expect(studioZoomPercentToSlider(500)).toBe(1000)
    expect(studioZoomPercentToSlider(200)).toBeGreaterThan(500)
    expect(studioZoomPercentToSlider(50)).toBeLessThan(500)

    const doc = document.implementation.createHTMLDocument('studio')
    const slider = doc.createElement('input')
    slider.id = 'sb-zoom-range'
    slider.setAttribute('aria-valuetext', '64%')
    doc.body.appendChild(slider)
    expect(readStudioZoom(doc)).toBeCloseTo(0.64)
  })

  it('snaps EPUB pinch zoom to supported font scale steps', () => {
    expect(nearestFontScale(1.12)).toBe(1.1)
    expect(nearestFontScale(1.38)).toBe(1.5)
    expect(nearestFontScale(0.2)).toBe(FONT_SCALES[0])
    expect(nearestFontScale(9)).toBe(FONT_SCALES[FONT_SCALES.length - 1])
  })

  it('pinch-zooms MarkdownMobileEditor inside its document viewport without transforming chrome', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    containers.push(container)
    const root = createRoot(container)
    roots.push(root)
    const onZoomChange = vi.fn()

    act(() => {
      root.render(
        <MarkdownMobileEditor
          value="# Title"
          mode="view"
          zoomScale={1}
          onZoomChange={onZoomChange}
          onChange={() => {}}
        />,
      )
    })

    const viewport = container.querySelector('.mobile-md-viewport') as HTMLElement
    expect(viewport).not.toBeNull()
    act(() => {
      viewport.dispatchEvent(
        fakeTouchEvent('touchstart', [
          [10, 10],
          [110, 10],
        ]),
      )
      viewport.dispatchEvent(
        fakeTouchEvent('touchmove', [
          [10, 10],
          [170, 10],
        ]),
      )
      viewport.dispatchEvent(fakeTouchEvent('touchend', []))
    })
    expect(onZoomChange).toHaveBeenCalledWith(1.6)
  })

  it('pinch-zooms HtmlPreviewFrame inside its sandboxed document only', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    containers.push(container)
    const root = createRoot(container)
    roots.push(root)

    act(() => {
      root.render(<HtmlPreviewFrame srcDoc="<html><body><p>Hello</p></body></html>" title="doc" />)
    })

    const frame = container.querySelector('iframe') as HTMLIFrameElement
    const frameDoc = frame.contentDocument!
    expect(frameDoc.documentElement.style.touchAction).toBe('pan-x pan-y')

    act(() => {
      frameDoc.dispatchEvent(
        fakeTouchEvent('touchstart', [
          [0, 0],
          [100, 0],
        ]),
      )
      frameDoc.dispatchEvent(
        fakeTouchEvent('touchmove', [
          [0, 0],
          [180, 0],
        ]),
      )
      frameDoc.dispatchEvent(fakeTouchEvent('touchend', []))
    })
    expect(frameDoc.documentElement.style.zoom).toBe('1.8')
  })
})

describe('reading view / page view naming and folder button across all languages', () => {
  it('uses "읽기 화면" and "쪽 화면" in Korean and natural equivalents across all 22 languages', () => {
    expect(translateMobile('ko', 'flowView')).toBe('읽기 화면')
    expect(translateMobile('ko', 'pageView')).toBe('쪽 화면')
    expect(translateMobile('ko', 'pageNumberDone')).toContain('쪽 화면')
    expect(translateMobile('ko', 'homeHelpFlowTitle')).toBe('한글 읽기 화면')
    expect(translateMobile('ko', 'homeHelpFlowBody2')).toContain('[쪽 화면]')
    expect(translateMobile('ko', 'homeRunTipFlowView')).toContain('읽기 화면')
    expect(translateMobile('ko', 'homeRunTipFlowView')).toContain('쪽 화면')
    expect(translateMobile('ko', 'homeFolderLink')).toBe('폴더 추가')

    expect(translateMobile('en', 'flowView')).toBe('Reading view')
    expect(translateMobile('en', 'pageView')).toBe('Page view')
    expect(translateMobile('en', 'homeRunTipFlowView')).toContain('reading view')
    expect(translateMobile('en', 'homeFolderLink')).toBe('Add folder')

    for (const lang of LANGS) {
      const dict = MOBILE_DICTS[lang]
      expect(dict.flowView.trim().length, `${lang}.flowView`).toBeGreaterThan(0)
      expect(dict.pageView.trim().length, `${lang}.pageView`).toBeGreaterThan(0)
      expect(dict.homeRunTipFlowView.trim().length, `${lang}.homeRunTipFlowView`).toBeGreaterThan(0)
      expect(dict.homeFolderLink.trim().length, `${lang}.homeFolderLink`).toBeGreaterThan(0)
      expect(dict.homeRunTipFlowView.toLowerCase(), `${lang}.homeRunTipFlowView`).not.toContain(
        'flow view',
      )
    }
  })
})
