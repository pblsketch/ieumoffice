import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions, pictureFilterCss } from '../src/renderer/editor/extensions'
import { hfImageEffectsStyle, makeHfFloatImgEl } from '../src/renderer/editor/hf-dom'

describe('watermark rendering and opacity', () => {
  it('pictureFilterCss emits opacity for a:alphaModFix alone and combined with filter effects', () => {
    expect(pictureFilterCss({ alpha: 0.25 })).toBe('opacity:0.25')
    expect(pictureFilterCss({ grayscale: true, alpha: 0.5 })).toBe(
      'filter:grayscale(1);opacity:0.5',
    )
    const wash = pictureFilterCss({ bright: 0.7, contrast: -0.7, alpha: 0.4 })
    expect(wash).toContain('filter:')
    expect(wash).toContain('opacity:0.4')
  })

  it('makeHfFloatImgEl applies DrawingML effects, opacity, washout, and rotation to header watermarks', () => {
    const el = makeHfFloatImgEl(
      {
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        widthPx: 300,
        heightPx: 300,
        floating: true,
        behind: true,
        posH: 'center',
        posV: 'center',
        posHRel: 'margin',
        posVRel: 'margin',
        rotationDeg: 315,
        effects: { bright: 0.7, contrast: -0.7, alpha: 0.25 },
      },
      {
        pageW: 794,
        pageH: 1123,
        marginLeft: 96,
        marginRight: 96,
        marginTop: 96,
        marginBottom: 96,
        headerDist: 48,
        sectMarginTop: 96,
      },
      'lead',
    )
    expect(el.style.filter).toContain('contrast(')
    expect(el.style.filter).toContain('brightness(')
    expect(el.style.opacity).toBe('0.25')
    expect(el.style.transform).toBe('translate(-50%, -50%) rotate(315deg)')
    expect(
      hfImageEffectsStyle({ washout: { gain: 0.3, blackLevel: 0.35 }, effects: { alpha: 0.5 } }),
    ).toEqual({
      filter: 'brightness(1.538) invert(1) brightness(0.195) invert(1)',
      opacity: '0.5',
    })
  })

  it('centers body behind-text floating images vertically via imagePosV and applies alpha opacity', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = new Editor({
      element: host,
      extensions: editorExtensions,
      content: {
        type: 'doc',
        content: [
          {
            type: 'docProtected',
            attrs: {
              blockType: 'image',
              imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
              imageWidthPx: 200,
              imageHeightPx: 200,
              imageWrap: 'behind',
              imagePosH: 'center',
              imagePosV: 'center',
              imageRelH: 'margin',
              imageRelV: 'margin',
              imageEffects: { alpha: 0.3 },
            },
          },
        ],
      },
    })
    try {
      const wrap = host.querySelector<HTMLElement>('.doc-img-wrap')
      const img = host.querySelector<HTMLImageElement>('img.doc-protected-img')
      expect(wrap).not.toBeNull()
      expect(wrap!.dataset.pageRelV).toBe('1')
      expect(wrap!.style.transform).toContain('translateX(-50%)')
      expect(wrap!.style.transform).toContain('translateY(-50%)')
      expect(wrap!.style.top).toContain('var(--page-h,1056px)')
      expect(wrap!.style.top).toContain('var(--doc-margin-bottom,0px)')
      expect(img!.style.opacity).toBe('0.3')
    } finally {
      editor.destroy()
      host.remove()
    }
  })
})
