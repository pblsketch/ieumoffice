import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const studioMock = vi.hoisted(() => ({
  createCalls: 0,
  destroyCalls: 0,
  lastIframe: null as HTMLIFrameElement | null,
  lastTextarea: null as HTMLTextAreaElement | null,
  exportHwpx: vi.fn(async () => new Uint8Array([1, 2, 3])),
  exportHwp: vi.fn(async () => new Uint8Array([4, 5, 6])),
}))

vi.mock('@rhwp/editor', () => ({
  createStudio: vi.fn(async (container: HTMLElement) => {
    studioMock.createCalls += 1
    const iframe = document.createElement('iframe')
    container.appendChild(iframe)
    const doc = iframe.contentDocument!
    const textarea = doc.createElement('textarea')
    const caret = doc.createElement('div')
    caret.className = 'caret'
    caret.style.display = 'block'
    const canvas = doc.createElement('canvas')
    canvas.width = 800
    canvas.height = 1100
    doc.body.appendChild(textarea)
    doc.body.appendChild(caret)
    doc.body.appendChild(canvas)
    studioMock.lastIframe = iframe
    studioMock.lastTextarea = textarea
    return {
      element: iframe,
      chrome: { set: vi.fn(async () => {}) },
      commands: {
        execute: vi.fn(async () => {}),
        context: vi.fn(async () => ({ isDirty: false })),
      },
      plugins: { load: vi.fn(async () => {}) },
      loadFile: vi.fn(async () => {
        // Simulate rhwp-studio focusing its internal input on load.
        textarea.focus()
        textarea.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
      }),
      exportHwp: studioMock.exportHwp,
      exportHwpx: studioMock.exportHwpx,
      exportHwpVerify: vi.fn(async () => ({ bytes: new Uint8Array([1]), ok: true })),
      notifySaved: vi.fn(async () => {}),
      destroy: vi.fn(() => {
        studioMock.destroyCalls += 1
        iframe.remove()
      }),
    }
  }),
}))

vi.mock('../src/renderer/assets/fonts', () => ({
  registerMobileKoreanFonts: vi.fn(async () => {}),
}))

import {
  HwpMobileEditor,
  type HwpMobileEditorHandle,
} from '../src/renderer/editors/HwpMobileEditor'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
  studioMock.createCalls = 0
  studioMock.destroyCalls = 0
  studioMock.lastIframe = null
  studioMock.lastTextarea = null
  studioMock.exportHwpx.mockClear()
  studioMock.exportHwp.mockClear()
})

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('HwpMobileEditor view/read-only guard', () => {
  it('locks studio inputs and ignores typing and dirty events when in view mode or read-only', async () => {
    const onDirty = vi.fn()
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root: Root = createRoot(el)
    cleanups.push(() => {
      act(() => root.unmount())
      el.remove()
    })
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    const ref = createRef<HwpMobileEditorHandle>()

    act(() => {
      root.render(
        <HwpMobileEditor
          ref={ref}
          fileName="sample.hwpx"
          documentBytes={bytes}
          mode="view"
          canEdit={false}
          hidden={false}
          lang="ko"
          theme="light"
          onDirty={onDirty}
        />,
      )
    })
    await flushMicrotasks()

    const textarea = studioMock.lastTextarea!
    const iframe = studioMock.lastIframe!
    const studioDoc = iframe.contentDocument!
    const caret = studioDoc.querySelector('.caret') as HTMLElement
    expect(textarea.readOnly).toBe(true)
    expect(textarea.inputMode).toBe('none')
    expect(textarea.tabIndex).toBe(-1)
    expect(studioDoc.documentElement.getAttribute('data-ieum-readonly')).toBe('true')
    expect(studioDoc.getElementById('ieum-mobile-studio-style')?.textContent).toContain(
      ':root[data-ieum-readonly="true"] .caret',
    )
    expect(studioDoc.defaultView?.getComputedStyle(caret).display).toBe('none')

    // Keydown and beforeinput inside the iframe are blocked in view/read-only mode.
    const keydown = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
    textarea.dispatchEvent(keydown)
    expect(keydown.defaultPrevented).toBe(true)

    const beforeInput = new Event('beforeinput', { bubbles: true, cancelable: true })
    textarea.dispatchEvent(beforeInput)
    expect(beforeInput.defaultPrevented).toBe(true)

    // Stray ieum:dirty events do not mark the document dirty while not interactively editing.
    iframe.contentWindow?.dispatchEvent(new CustomEvent('ieum:dirty', { detail: true }))
    expect(onDirty).not.toHaveBeenCalled()

    // Switching to interactive edit mode unlocks the studio input and allows dirty reporting.
    act(() => {
      root.render(
        <HwpMobileEditor
          ref={ref}
          fileName="sample.hwpx"
          documentBytes={bytes}
          mode="edit"
          canEdit
          hidden={false}
          lang="ko"
          theme="light"
          onDirty={onDirty}
        />,
      )
    })
    expect(textarea.readOnly).toBe(false)
    expect(textarea.inputMode).toBe('')
    expect(textarea.tabIndex).toBe(0)
    expect(studioDoc.documentElement.hasAttribute('data-ieum-readonly')).toBe(false)
    expect(studioDoc.defaultView?.getComputedStyle(caret).display).toBe('block')

    const editKeydown = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
    textarea.dispatchEvent(editKeydown)
    expect(editKeydown.defaultPrevented).toBe(false)

    iframe.contentWindow?.dispatchEvent(new CustomEvent('ieum:dirty', { detail: true }))
    expect(onDirty).toHaveBeenCalledTimes(1)
  })

  it('does not recreate rhwp-studio when fileName changes after Save As and rejects export async if unmounted', async () => {
    const onDirty = vi.fn()
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root: Root = createRoot(el)
    cleanups.push(() => {
      act(() => root.unmount())
      el.remove()
    })
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    const ref = createRef<HwpMobileEditorHandle>()

    act(() => {
      root.render(
        <HwpMobileEditor
          ref={ref}
          fileName="Untitled.hwpx"
          documentBytes={bytes}
          mode="edit"
          canEdit
          hidden={false}
          lang="ko"
          theme="light"
          onDirty={onDirty}
        />,
      )
    })
    await flushMicrotasks()
    expect(studioMock.createCalls).toBe(1)
    expect(studioMock.destroyCalls).toBe(0)

    // Save As renames the session and [Done] switches to view mode simultaneously.
    act(() => {
      root.render(
        <HwpMobileEditor
          ref={ref}
          fileName="qa-lucia.hwpx"
          documentBytes={bytes}
          mode="view"
          canEdit
          hidden={false}
          lang="ko"
          theme="light"
          onDirty={onDirty}
        />,
      )
    })
    await flushMicrotasks()

    expect(studioMock.createCalls).toBe(1)
    expect(studioMock.destroyCalls).toBe(0)
    const port = ref.current!.getSavePort()
    const exported = await port.exportHwpx()
    expect(exported).toEqual(new Uint8Array([1, 2, 3]))

    // After unmount, canvas backing stores are zeroed, iframe navigates to about:blank,
    // and export methods reject asynchronously rather than throwing synchronously.
    const iframe = studioMock.lastIframe!
    const canvas = iframe.contentDocument!.querySelector('canvas') as HTMLCanvasElement
    expect(canvas.width).toBe(800)
    expect(canvas.height).toBe(1100)

    act(() => root.unmount())
    expect(studioMock.destroyCalls).toBe(1)
    expect(canvas.width).toBe(0)
    expect(canvas.height).toBe(0)
    expect(iframe.getAttribute('src')).toBe('about:blank')
    expect(() => {
      void port.exportHwpx().catch(() => {})
      void port.exportHwp().catch(() => {})
      void port.exportHwpVerify().catch(() => {})
    }).not.toThrow()
    await expect(port.exportHwpx()).rejects.toThrow('HWP editor is not ready.')
  })
})
