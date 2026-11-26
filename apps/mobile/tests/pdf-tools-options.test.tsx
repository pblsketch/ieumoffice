/**
 * The PDF tools options sheet forms and the blank-page review (spec 5.3):
 * each tool's form writes the raw keys `checkOptions` reads, starts from the
 * PC window's defaults, shows an option error under its field, and keeps
 * passwords out of logs and out of the screen after a run.
 */
import { act, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkOptions, DEFAULT_ANNOT_KINDS } from '@genoffice/pdf-ops/tool-rules'
import { PDF_TOOL_ANNOT_KINDS } from '@genoffice/pdf-ops/tool-ids'
import type { MobileClient } from '@genoffice/mobile-bridge/transport'
import type { HomeHost } from '../src/renderer/home/homeHost'
import { translateMobile, type MobileStringKey } from '../src/renderer/i18n'
import { BackStackProvider } from '../src/renderer/shell/backStack'
import { BlankReview, initialBlankChoice } from '../src/renderer/tools/blank'
import type { MobilePdfToolId } from '../src/renderer/tools/catalog'
import type {
  BlankCandidateView,
  PdfToolsEngine,
  ToolFile,
  ToolRunOutcome,
} from '../src/renderer/tools/engine/types'
import { PdfToolsEnvProvider } from '../src/renderer/tools/env'
import PdfToolsFlowScreen from '../src/renderer/tools/flow/Flow'
import {
  initialToolOptions,
  ToolOptionsForm,
  type ToolOptionsError,
} from '../src/renderer/tools/options'

// React's act() checks this flag
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const en = (key: MobileStringKey, params?: Record<string, string | number>) =>
  translateMobile('en', key, params)

const MB = 1024 * 1024

// ---- rendering

const roots: Root[] = []
const containers: HTMLElement[] = []

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  while (containers.length > 0) containers.pop()?.remove()
  vi.restoreAllMocks()
})

async function flush(times = 3) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  }
}

async function mount(node: ReactNode): Promise<HTMLElement> {
  const el = document.createElement('div')
  document.body.appendChild(el)
  containers.push(el)
  const root = createRoot(el)
  roots.push(root)
  await act(async () => {
    root.render(node)
  })
  await flush()
  return el
}

interface FormSetup {
  tool: MobilePdfToolId
  pageCount?: number
  raw?: Record<string, unknown>
  error?: ToolOptionsError | null
  inputName?: string
}

/** The form with the flow's part played: raw kept here, error given as asked */
async function renderForm(setup: FormSetup) {
  const state: { raw: Record<string, unknown>; setError(e: ToolOptionsError | null): void } = {
    raw: setup.raw ?? initialToolOptions(setup.tool),
    setError: () => {},
  }
  const input: ToolFile | null = setup.inputName
    ? { name: setup.inputName, mime: 'application/pdf', readBytes: async () => new Uint8Array() }
    : null
  function Harness() {
    const [raw, setRaw] = useState(state.raw)
    const [error, setError] = useState<ToolOptionsError | null>(setup.error ?? null)
    state.setError = setError
    return (
      <ToolOptionsForm
        tool={setup.tool}
        pageCount={setup.pageCount ?? 10}
        input={input}
        raw={raw}
        onChange={(next) => {
          state.raw = next
          setRaw(next)
        }}
        error={error}
      />
    )
  }
  const el = await mount(<Harness />)
  return {
    el,
    raw: () => state.raw,
    checked: () => checkOptions(setup.tool, state.raw, setup.pageCount ?? 10),
    showError: async (error: ToolOptionsError | null) => {
      await act(async () => state.setError(error))
    },
  }
}

// ---- controls

/** The radio, checkbox or switch a visible label wrapping it names */
function control(root: HTMLElement, text: string): HTMLInputElement {
  const label = [...root.querySelectorAll('label.pdf-tools-choice, label.pdf-tools-toggle')].find(
    (l) => l.textContent?.trim() === text,
  )
  const target = label?.querySelector('input')
  if (!target) throw new Error(`no choice "${text}"`)
  return target
}

/** The text, number or password field a visible <label for> names */
function field(root: HTMLElement, text: string): HTMLInputElement {
  const label = [...root.querySelectorAll<HTMLLabelElement>('label.pdf-tools-field-label')].find(
    (l) => l.textContent?.trim() === text,
  )
  const target = label ? root.ownerDocument.getElementById(label.htmlFor) : null
  if (!(target instanceof HTMLInputElement)) throw new Error(`no field "${text}"`)
  return target
}

const found = (lookup: () => unknown) => {
  try {
    lookup()
    return true
  } catch {
    return false
  }
}
const hasLabel = (root: HTMLElement, text: string) => found(() => control(root, text))
const hasField = (root: HTMLElement, text: string) => found(() => field(root, text))

async function type(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click()
  })
}

async function blur(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

/** The error shown under the field `el` (by aria-describedby) */
function errorOf(el: HTMLElement): string | null {
  const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
  for (const id of ids) {
    const node = el.ownerDocument.getElementById(id)
    if (node?.classList.contains('pdf-tools-field-error')) return node.textContent
  }
  return null
}

const radiosOf = (root: HTMLElement, legend: string) => {
  const set = [...root.querySelectorAll('fieldset')].find(
    (f) =>
      f.querySelector('legend')?.textContent?.trim() === legend ||
      f.getAttribute('aria-label') === legend,
  )
  if (!set) throw new Error(`no group "${legend}"`)
  return set
}

// ---- the forms

describe('defaults', () => {
  it('starts every tool from the PC window defaults', () => {
    expect(checkOptions('rotate', initialToolOptions('rotate'), 3)).toEqual({
      ok: true,
      options: { rotation: 90 },
    })
    expect(checkOptions('compress', initialToolOptions('compress'), 3)).toEqual({
      ok: true,
      options: { compressLevel: 'medium' },
    })
    expect(checkOptions('stripAnnots', initialToolOptions('stripAnnots'), 3)).toEqual({
      ok: true,
      options: { annotKinds: DEFAULT_ANNOT_KINDS, applyPages: '' },
    })
    expect(checkOptions('imagesToPdf', initialToolOptions('imagesToPdf'), 1)).toEqual({
      ok: true,
      options: { imagePaper: 'A4', margin: 'small' },
    })
    expect(initialToolOptions('split')).toMatchObject({
      splitMode: 'ranges',
      splitMergeRanges: false,
      splitFixedKind: 'pagesPerFile',
      splitFixedValue: 1,
      splitBookmarkLevel: 1,
      splitIncludeLeading: true,
      splitMaxBytes: 10 * MB,
      splitPattern: 'numbered',
    })
    // the PC window has no default page range for extract, and passwords are typed
    expect(checkOptions('extract', initialToolOptions('extract'), 3)).toEqual({
      ok: false,
      error: 'range',
    })
    expect(checkOptions('encrypt', initialToolOptions('encrypt'), 3)).toEqual({
      ok: false,
      error: 'password-empty',
    })
    expect(checkOptions('decrypt', initialToolOptions('decrypt'), 3)).toEqual({
      ok: false,
      error: 'password-empty',
    })
  })

  it('draws nothing for merge, reverse and toText', async () => {
    for (const tool of ['merge', 'reverse', 'toText'] as const) {
      const { el } = await renderForm({ tool })
      expect(el.innerHTML).toBe('')
    }
  })
})

describe('split', () => {
  it('fills the two halves as the range, like the PC window, and runs without edits', async () => {
    const form = await renderForm({ tool: 'split', pageCount: 10, inputName: 'report.pdf' })
    expect(form.raw().splitRanges).toBe('1-5, 6-10')
    expect(field(form.el, en('pdfToolsSplitRangesLabel')).value).toBe('1-5, 6-10')
    expect(form.checked()).toEqual({
      ok: true,
      options: {
        splitMode: 'ranges',
        splitPattern: 'numbered',
        splitCreateSubfolder: false,
        splitRanges: '1-5, 6-10',
        splitMergeRanges: false,
      },
    })
    // the name starts with the file's name unless another is typed
    expect(field(form.el, en('pdfToolsSplitPrefix')).placeholder).toBe('report')
    expect(form.el.textContent).toContain(en('pdfToolsSplitPreviewCount', { n: 2 }))
    // no subfolder and no "cut in the editor" on the phone
    expect(form.el.querySelectorAll('button')).toHaveLength(0)
  })

  it('fills one page as "1" and refills an untouched range for another page count', async () => {
    const one = await renderForm({ tool: 'split', pageCount: 1 })
    expect(one.raw().splitRanges).toBe('1')
    const other = await renderForm({ tool: 'split', pageCount: 4, raw: one.raw() })
    expect(other.raw().splitRanges).toBe('1-2, 3-4')
    // a typed range stays
    await type(field(other.el, en('pdfToolsSplitRangesLabel')), '1, 2-4')
    const again = await renderForm({ tool: 'split', pageCount: 6, raw: other.raw() })
    expect(again.raw().splitRanges).toBe('1, 2-4')
  })

  it('writes the ranges, the merge toggle, the prefix and shows a range error under the field', async () => {
    const form = await renderForm({ tool: 'split', pageCount: 10 })
    const ranges = field(form.el, en('pdfToolsSplitRangesLabel'))
    await type(ranges, '1-3, 4-8')
    await click(control(form.el, en('pdfToolsSplitMergeRanges')))
    await type(field(form.el, en('pdfToolsSplitPrefix')), 'part')
    expect(form.checked()).toEqual({
      ok: true,
      options: {
        splitMode: 'ranges',
        splitPattern: 'numbered',
        splitCreateSubfolder: false,
        splitPrefix: 'part',
        splitRanges: '1-3, 4-8',
        splitMergeRanges: true,
      },
    })
    expect(form.el.textContent).toContain(en('pdfToolsSplitPreviewOne'))
    await type(ranges, '1-30')
    expect(form.checked()).toEqual({ ok: false, error: 'range' })
    expect(errorOf(ranges)).toBeNull()
    await form.showError('range')
    expect(errorOf(ranges)).toBe(en('pdfToolsErrRange'))
    expect(ranges.getAttribute('aria-invalid')).toBe('true')
  })

  it('switches between the four modes as radios', async () => {
    const form = await renderForm({ tool: 'split', pageCount: 10 })
    const modes = radiosOf(form.el, en('pdfToolsToolSplit'))
    const labels = [...modes.querySelectorAll('label')].map((l) => l.textContent?.trim())
    expect(labels).toEqual([
      en('pdfToolsSplitModeRanges'),
      en('pdfToolsSplitModeFixed'),
      en('pdfToolsSplitModeBookmarks'),
      en('pdfToolsSplitModeMaxSize'),
    ])
    expect([...modes.querySelectorAll('input')].every((i) => i.type === 'radio')).toBe(true)

    // fixed: pages per file or file count, clamped to the pages
    await click(control(form.el, en('pdfToolsSplitModeFixed')))
    expect(form.raw().splitMode).toBe('fixed')
    expect(hasField(form.el, en('pdfToolsSplitRangesLabel'))).toBe(false)
    const perFile = field(form.el, en('pdfToolsOptChunk'))
    await type(perFile, '3')
    expect(form.checked()).toMatchObject({
      ok: true,
      options: { splitMode: 'fixed', splitFixedKind: 'pagesPerFile', splitFixedValue: 3 },
    })
    expect(form.el.textContent).toContain(en('pdfToolsSplitPreviewCount', { n: 4 }))
    await type(perFile, '50')
    expect(form.raw().splitFixedValue).toBe(10)
    await type(perFile, '')
    expect(form.raw().splitFixedValue).toBe(10)
    await blur(perFile)
    expect(perFile.value).toBe('10')
    await click(control(form.el, en('pdfToolsSplitFixedCount')))
    await type(field(form.el, en('pdfToolsSplitFixedFilesLabel')), '4')
    expect(form.checked()).toMatchObject({
      ok: true,
      options: { splitFixedKind: 'fileCount', splitFixedValue: 4 },
    })

    // bookmarks: level 1 or 2, leading pages, and the bookmark title pattern
    await click(control(form.el, en('pdfToolsSplitModeBookmarks')))
    expect(form.raw().splitPattern).toBe('bookmark')
    await click(control(form.el, en('pdfToolsSplitBookmarkLevel2')))
    await click(control(form.el, en('pdfToolsSplitIncludeLeading')))
    expect(form.checked()).toMatchObject({
      ok: true,
      options: {
        splitMode: 'bookmarks',
        splitBookmarkLevel: 2,
        splitIncludeLeading: false,
        splitPattern: 'bookmark',
      },
    })
    const patterns = radiosOf(form.el, en('pdfToolsSplitPattern'))
    expect([...patterns.querySelectorAll('label')].map((l) => l.textContent?.trim())).toEqual([
      en('pdfToolsSplitPatternNumbered'),
      en('pdfToolsSplitPatternRange'),
      en('pdfToolsSplitPatternBookmark'),
    ])

    // leaving bookmarks drops the bookmark title pattern
    await click(control(form.el, en('pdfToolsSplitModeRanges')))
    expect(form.raw().splitPattern).toBe('numbered')
    expect(hasLabel(form.el, en('pdfToolsSplitPatternBookmark'))).toBe(false)
    await click(control(form.el, en('pdfToolsSplitPatternRange')))
    await click(control(form.el, en('pdfToolsSplitModeFixed')))
    // a pattern the user picked stays
    expect(form.raw().splitPattern).toBe('range')
  })

  it('converts the largest size with its unit and refuses sizes out of 10 KB–1 GB', async () => {
    const form = await renderForm({ tool: 'split', pageCount: 10 })
    await click(control(form.el, en('pdfToolsSplitModeMaxSize')))
    const size = field(form.el, en('pdfToolsSplitMaxSizeLabel'))
    expect(size.value).toBe('10')
    expect(control(form.el, 'MB').checked).toBe(true)
    expect(form.checked()).toMatchObject({
      ok: true,
      options: { splitMode: 'maxSize', splitMaxBytes: 10 * MB },
    })
    await type(size, '2.5')
    expect(form.raw().splitMaxBytes).toBe(Math.round(2.5 * MB))
    await type(size, '500')
    await click(control(form.el, 'KB'))
    expect(form.raw().splitMaxBytes).toBe(500 * 1024)
    expect(size.value).toBe('500')
    await type(size, '5')
    expect(form.raw().splitMaxBytes).toBe(5 * 1024)
    expect(form.checked()).toEqual({ ok: false, error: 'invalid-size' })
    await type(size, '')
    expect(form.checked()).toEqual({ ok: false, error: 'invalid-size' })
    await form.showError('invalid-size')
    expect(errorOf(size)).toBe(en('pdfToolsErrInvalidSize'))
    await type(size, '1,5')
    await click(control(form.el, 'MB'))
    expect(form.raw().splitMaxBytes).toBe(Math.round(1.5 * MB))
    expect(form.el.textContent).toContain(en('pdfToolsSplitMaxSizeNote'))

    // the unit comes back with the size when the sheet opens again
    const again = await renderForm({ tool: 'split', pageCount: 10, raw: { ...form.raw() } })
    expect(field(again.el, en('pdfToolsSplitMaxSizeLabel')).value).toBe('1.5')
    const small = await renderForm({
      tool: 'split',
      pageCount: 10,
      raw: { ...form.raw(), splitMaxBytes: 300 * 1024 },
    })
    expect(field(small.el, en('pdfToolsSplitMaxSizeLabel')).value).toBe('300')
    expect(control(small.el, 'KB').checked).toBe(true)
  })
})

describe('extract, rotate, compress', () => {
  it('extract takes a page range, shows the page count and its error under the field', async () => {
    const form = await renderForm({ tool: 'extract', pageCount: 12 })
    expect(form.el.textContent).toContain(en('pdfToolsPageCount', { n: 12 }))
    const range = field(form.el, en('pdfToolsOptRange'))
    expect(range.placeholder).toBe('1-12')
    await type(range, '1-3, 5')
    expect(form.raw().pages).toBe('1-3, 5')
    expect(form.checked()).toEqual({ ok: true, options: { pages: '1,2,3,5' } })
    await type(range, '13')
    await form.showError('range')
    expect(errorOf(range)).toBe(en('pdfToolsErrRange'))
    const one = await renderForm({ tool: 'extract', pageCount: 1 })
    expect(one.el.textContent).toContain(en('pdfToolsPageCountOne'))
  })

  it('rotate offers right 90, 180 and left 90', async () => {
    const form = await renderForm({ tool: 'rotate' })
    const group = radiosOf(form.el, en('pdfToolsOptRotation'))
    expect([...group.querySelectorAll('label')].map((l) => l.textContent?.trim())).toEqual([
      en('pdfToolsOptRotateRight'),
      en('pdfToolsOpt180'),
      en('pdfToolsOptRotateLeft'),
    ])
    expect(control(form.el, en('pdfToolsOptRotateRight')).checked).toBe(true)
    await click(control(form.el, en('pdfToolsOpt180')))
    expect(form.checked()).toEqual({ ok: true, options: { rotation: 180 } })
    await click(control(form.el, en('pdfToolsOptRotateLeft')))
    expect(form.checked()).toEqual({ ok: true, options: { rotation: 270 } })
  })

  it('compress offers three levels, medium first chosen', async () => {
    const form = await renderForm({ tool: 'compress' })
    expect(control(form.el, en('pdfToolsLevelMedium')).checked).toBe(true)
    await click(control(form.el, en('pdfToolsLevelStrong')))
    expect(form.checked()).toEqual({ ok: true, options: { compressLevel: 'strong' } })
    await click(control(form.el, en('pdfToolsLevelLight')))
    expect(form.checked()).toEqual({ ok: true, options: { compressLevel: 'light' } })
    expect(form.el.textContent).toContain(en('pdfToolsNoteCompress'))
  })
})

describe('passwords', () => {
  const expectSecret = (el: HTMLInputElement) => {
    expect(el.type).toBe('password')
    expect(el.getAttribute('autocomplete')).toBe('off')
    expect(el.getAttribute('autocapitalize')).toBe('off')
    expect(el.getAttribute('spellcheck')).toBe('false')
  }

  it('encrypt: two password fields, the restriction reveals the permission password', async () => {
    const form = await renderForm({ tool: 'encrypt' })
    const password = field(form.el, en('pdfToolsOptPassword'))
    const again = field(form.el, en('pdfToolsOptPasswordConfirm'))
    expectSecret(password)
    expectSecret(again)
    expect(hasField(form.el, en('pdfToolsOptPermissionPassword'))).toBe(false)
    await form.showError('password-empty')
    expect(errorOf(password)).toBe(en('pdfToolsErrPasswordEmpty'))
    await form.showError(null)

    await type(password, 'open-me')
    await type(again, 'open-mx')
    expect(form.raw()).toMatchObject({ password: 'open-me', passwordConfirm: 'open-mx' })
    await form.showError('password-mismatch')
    expect(errorOf(again)).toBe(en('pdfToolsPasswordMismatch'))
    expect(errorOf(password)).toBeNull()
    await type(again, 'open-me')
    await form.showError(null)
    expect(form.checked()).toEqual({ ok: true, options: { password: 'open-me' } })

    const restrict = control(form.el, en('pdfToolsOptRestrict'))
    expect(restrict.type).toBe('checkbox')
    await click(restrict)
    const permission = field(form.el, en('pdfToolsOptPermissionPassword'))
    expectSecret(permission)
    expect(form.el.textContent).toContain(en('pdfToolsNoteRestrict'))
    expect(form.checked()).toEqual({ ok: false, error: 'password-empty' })
    await form.showError('password-empty')
    expect(errorOf(permission)).toBe(en('pdfToolsErrPasswordEmpty'))
    expect(errorOf(password)).toBeNull()
    await type(permission, 'open-me')
    expect(form.checked()).toEqual({ ok: false, error: 'password-same' })
    await form.showError('password-same')
    expect(errorOf(permission)).toBe(en('pdfToolsErrPasswordSame'))
    await type(permission, 'change-me')
    expect(form.checked()).toEqual({
      ok: true,
      options: { password: 'open-me', restrict: true, permissionPassword: 'change-me' },
    })

    // turning the restriction off forgets the permission password
    await click(restrict)
    expect(form.raw()).not.toHaveProperty('permissionPassword')
    expect(form.raw().restrict).toBe(false)
  })

  it('encrypt: says a password longer than 127 bytes is too long, under that field', async () => {
    const form = await renderForm({ tool: 'encrypt' })
    const password = field(form.el, en('pdfToolsOptPassword'))
    // 43 three-byte letters = 129 bytes
    const long = '가'.repeat(43)
    await type(password, long)
    await type(field(form.el, en('pdfToolsOptPasswordConfirm')), long)
    expect(form.checked()).toEqual({ ok: false, error: 'password-long' })
    await form.showError('password-long')
    expect(errorOf(password)).toBe(en('pdfToolsErrPasswordLong'))

    await type(password, 'short')
    await click(control(form.el, en('pdfToolsOptRestrict')))
    const permission = field(form.el, en('pdfToolsOptPermissionPassword'))
    await type(permission, 'x'.repeat(128))
    expect(form.checked()).toEqual({ ok: false, error: 'password-long' })
    expect(errorOf(permission)).toBe(en('pdfToolsErrPasswordLong'))
    expect(errorOf(password)).toBeNull()
  })

  it('decrypt: the current password', async () => {
    const form = await renderForm({ tool: 'decrypt' })
    const current = field(form.el, en('pdfToolsOptCurrentPassword'))
    expectSecret(current)
    await form.showError('password-empty')
    expect(errorOf(current)).toBe(en('pdfToolsErrPasswordEmpty'))
    await type(current, 'secret')
    expect(form.checked()).toEqual({ ok: true, options: { password: 'secret' } })
    expect(form.el.textContent).toContain(en('pdfToolsNoteDecrypt'))
  })
})

describe('stripAnnots and imagesToPdf', () => {
  it('stripAnnots: every kind but links chosen, pages optional', async () => {
    const form = await renderForm({ tool: 'stripAnnots', pageCount: 8 })
    const keys: Record<(typeof PDF_TOOL_ANNOT_KINDS)[number], MobileStringKey> = {
      comments: 'pdfToolsKindComments',
      highlights: 'pdfToolsKindHighlights',
      drawings: 'pdfToolsKindDrawings',
      stamps: 'pdfToolsKindStamps',
      links: 'pdfToolsKindLinks',
      other: 'pdfToolsKindOther',
    }
    for (const kind of PDF_TOOL_ANNOT_KINDS) {
      const box = control(form.el, en(keys[kind]))
      expect(box.type).toBe('checkbox')
      expect(box.checked, kind).toBe(kind !== 'links')
    }
    await click(control(form.el, en('pdfToolsKindLinks')))
    await click(control(form.el, en('pdfToolsKindComments')))
    expect(form.checked()).toEqual({
      ok: true,
      options: {
        annotKinds: ['highlights', 'drawings', 'stamps', 'links', 'other'],
        applyPages: '',
      },
    })
    const pages = field(form.el, en('pdfToolsOptCleanPages'))
    await type(pages, '2-3')
    expect(form.checked()).toMatchObject({ ok: true, options: { applyPages: '2,3' } })
    await type(pages, '9')
    await form.showError('range')
    expect(errorOf(pages)).toBe(en('pdfToolsErrRange'))
    await type(pages, '')

    for (const kind of PDF_TOOL_ANNOT_KINDS) {
      const box = control(form.el, en(keys[kind]))
      if (box.checked) await click(box)
    }
    expect(form.checked()).toEqual({ ok: false, error: 'no-kinds' })
    await form.showError('no-kinds')
    const group = radiosOf(form.el, en('pdfToolsOptAnnotKinds'))
    expect(errorOf(group)).toBe(en('pdfToolsErrNoKinds'))
  })

  it('imagesToPdf: papers with the picture size, margins only on paper', async () => {
    const form = await renderForm({ tool: 'imagesToPdf', pageCount: 1 })
    const papers = radiosOf(form.el, en('pdfToolsOptPaper'))
    expect([...papers.querySelectorAll('label')].map((l) => l.textContent?.trim())).toEqual([
      'A3',
      'A4',
      'A5',
      'Letter',
      'Legal',
      en('pdfToolsOptImageSize'),
    ])
    expect(control(form.el, 'A4').checked).toBe(true)
    expect(control(form.el, en('pdfToolsOptMarginSmall')).checked).toBe(true)
    await click(control(form.el, 'Letter'))
    await click(control(form.el, en('pdfToolsOptMarginLarge')))
    expect(checkOptions('imagesToPdf', form.raw(), 1)).toEqual({
      ok: true,
      options: { imagePaper: 'Letter', margin: 'large' },
    })
    await click(control(form.el, en('pdfToolsOptMarginNone')))
    expect(form.raw().margin).toBe('none')
    await click(control(form.el, en('pdfToolsOptImageSize')))
    expect(form.raw().imagePaper).toBe('image')
    expect(hasLabel(form.el, en('pdfToolsOptMarginNone'))).toBe(false)
  })

  it('names every radio group and keeps every choice a 48px row', async () => {
    const form = await renderForm({ tool: 'imagesToPdf', pageCount: 1 })
    for (const set of form.el.querySelectorAll('fieldset')) {
      const name = set.querySelector('legend')?.textContent || set.getAttribute('aria-label')
      expect(name).toBeTruthy()
    }
    for (const label of form.el.querySelectorAll('label')) {
      expect(label.className).toMatch(/pdf-tools-(choice|toggle)/)
    }
  })
})

// ---- blank pages

function thumb(width: number, height: number): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
    colorSpace: 'srgb',
  } as ImageData
}

async function renderReview(
  candidates: BlankCandidateView[],
  pageCount = 10,
  start?: ReadonlySet<number>,
) {
  const state = { chosen: start ?? initialBlankChoice(candidates) }
  function Harness() {
    const [chosen, setChosen] = useState(state.chosen)
    return (
      <BlankReview
        candidates={candidates}
        pageCount={pageCount}
        chosen={chosen}
        onChange={(next) => {
          state.chosen = next
          setChosen(next)
        }}
      />
    )
  }
  const el = await mount(<Harness />)
  return { el, chosen: () => [...state.chosen].sort((a, b) => a - b) }
}

describe('blank-page review', () => {
  let drawn: ImageData[]
  beforeEach(() => {
    drawn = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      return {
        putImageData: (image: ImageData) => drawn.push(image),
      } as unknown as CanvasRenderingContext2D
    } as unknown as HTMLCanvasElement['getContext'])
  })

  const candidates: BlankCandidateView[] = [
    { page: 2, reason: 'empty', thumb: thumb(170, 240) },
    { page: 5, reason: 'nearly-white', thumb: thumb(240, 170) },
    { page: 9, reason: 'empty', thumb: null },
  ]

  it('preselects the pages with nothing on them', () => {
    expect([...initialBlankChoice(candidates)]).toEqual([2, 9])
  })

  it('draws each thumbnail, a placeholder without one, the page and the reason', async () => {
    const { el } = await renderReview(candidates)
    const tiles = [...el.querySelectorAll('[data-testid="pdf-tools-blank-tile"]')]
    expect(tiles).toHaveLength(3)
    const canvases = el.querySelectorAll('canvas')
    expect(canvases).toHaveLength(2)
    expect([canvases[0]!.width, canvases[0]!.height]).toEqual([170, 240])
    expect(drawn).toEqual([candidates[0]!.thumb, candidates[1]!.thumb])
    expect(tiles[2]!.querySelector('canvas')).toBeNull()
    expect(tiles[2]!.querySelector('.pdf-tools-blank-placeholder')?.textContent).toBe('9')
    expect(tiles.map((t) => t.textContent)).toEqual([
      expect.stringContaining(en('pdfToolsBlankPageLabel', { n: 2 })),
      expect.stringContaining(en('pdfToolsBlankNearlyWhite')),
      expect.stringContaining(en('pdfToolsBlankEmpty')),
    ])
    // the picture is decoration: the label names the page
    for (const canvas of canvases) expect(canvas.getAttribute('aria-hidden')).toBe('true')
  })

  it('toggles by tapping, selects all or none and counts the chosen pages', async () => {
    const review = await renderReview(candidates)
    const count = () =>
      review.el.querySelector('[data-testid="pdf-tools-blank-count"]')?.textContent
    expect(count()).toBe(en('pdfToolsBlankChosenCount', { n: 2 }))
    const boxes = [...review.el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    expect(boxes.map((b) => b.checked)).toEqual([true, false, true])
    // a tap on the picture toggles too (the whole tile is the label)
    await click(review.el.querySelectorAll<HTMLElement>('canvas')[1]!)
    expect(review.chosen()).toEqual([2, 5, 9])
    await click(boxes[0]!)
    expect(review.chosen()).toEqual([5, 9])
    expect(count()).toBe(en('pdfToolsBlankChosenCount', { n: 2 }))
    const buttonOf = (key: MobileStringKey) =>
      [...review.el.querySelectorAll('button')].find((b) => b.textContent === en(key))!
    await click(buttonOf('pdfToolsSelectAll'))
    expect(review.chosen()).toEqual([2, 5, 9])
    expect(buttonOf('pdfToolsSelectAll').disabled).toBe(true)
    await click(buttonOf('pdfToolsSelectNone'))
    expect(review.chosen()).toEqual([])
    expect(count()).toBe(en('pdfToolsBlankChosenCount', { n: 0 }))
    expect(buttonOf('pdfToolsSelectNone').disabled).toBe(true)
  })

  it('draws thumbnails only when they come into view when the browser can tell', async () => {
    const observed: Element[] = []
    let notify: ((entries: Partial<IntersectionObserverEntry>[]) => void) | null = null
    const disconnect = vi.fn()
    class FakeObserver {
      constructor(cb: (entries: Partial<IntersectionObserverEntry>[]) => void) {
        notify = cb
      }
      observe(el: Element) {
        observed.push(el)
      }
      unobserve() {}
      disconnect = disconnect
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    try {
      const many: BlankCandidateView[] = Array.from({ length: 300 }, (_, i) => ({
        page: i + 1,
        reason: 'empty' as const,
        thumb: thumb(10, 14),
      }))
      const { el } = await renderReview(many, 400)
      expect(el.querySelectorAll('[data-testid="pdf-tools-blank-tile"]')).toHaveLength(300)
      expect(drawn).toHaveLength(0)
      expect(observed).toHaveLength(300)
      await act(async () =>
        notify!([
          { target: observed[0]!, isIntersecting: true },
          { target: observed[1]!, isIntersecting: false },
        ]),
      )
      expect(drawn).toEqual([many[0]!.thumb])
      act(() => roots.pop()!.unmount())
      expect(disconnect).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

// ---- passwords in the flow

describe('passwords in the flow', () => {
  function fakeEngine() {
    const runs: Array<{
      options: Record<string, unknown>
      resolve(outcome: ToolRunOutcome): void
    }> = []
    const engine = {
      inspect: vi.fn(async () => ({ ok: true as const, pages: 3, sizeBytes: 100 })),
      run: vi.fn((_tool: string, _files: readonly ToolFile[], options: Record<string, unknown>) => {
        return new Promise<ToolRunOutcome>((resolve) => runs.push({ options, resolve }))
      }),
      findBlankPages: vi.fn(),
      zip: vi.fn(),
      stop: vi.fn(),
      dispose: vi.fn(),
    }
    return { engine: engine as unknown as PdfToolsEngine, runs }
  }

  function fakeHost() {
    const client = { transport: { invoke: vi.fn(), listen: vi.fn() } } as unknown as MobileClient
    return {
      client,
      openSession: vi.fn(async () => {}),
      createNew: vi.fn(async () => {}),
      showToast: vi.fn(),
      refreshHome: vi.fn(async () => {}),
      openSettings: vi.fn(),
    } as unknown as HomeHost
  }

  const button = (text: string) =>
    [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === text,
    )!

  async function toOptions(tool: MobilePdfToolId) {
    const { engine, runs } = fakeEngine()
    vi.spyOn(window.history, 'back').mockImplementation(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await mount(
      <BackStackProvider>
        <PdfToolsEnvProvider value={{ createEngine: () => engine, editorOpens: () => false }}>
          <PdfToolsFlowScreen host={fakeHost()} start={{ kind: 'tool', tool }} onClose={() => {}} />
        </PdfToolsEnvProvider>
      </BackStackProvider>,
    )
    const picker = document.body.querySelector<HTMLInputElement>(
      '[data-testid="pdf-tools-file-input"]',
    )!
    Object.defineProperty(picker, 'files', {
      value: [new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })],
      configurable: true,
    })
    await act(async () => {
      picker.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    await click(button(en('pdfToolsNext')))
    await flush()
    return { runs, sheet: () => document.body.querySelector<HTMLElement>('.pdf-tools-options')! }
  }

  const consoleSpies = () =>
    (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => {}),
    )

  const logged = (spies: ReturnType<typeof consoleSpies>) =>
    spies.flatMap((spy) => spy.mock.calls.map((args) => args.map(String).join(' '))).join('\n')

  it('encrypt: sends only the checked password, then clears every field and logs nothing', async () => {
    const spies = consoleSpies()
    const { runs, sheet } = await toOptions('encrypt')
    await type(field(sheet(), en('pdfToolsOptPassword')), 'Op3n-Sesame')
    await type(field(sheet(), en('pdfToolsOptPasswordConfirm')), 'Op3n-Sesam')
    await click(button(en('pdfToolsStart')))
    expect(runs).toHaveLength(0)
    expect(errorOf(field(sheet(), en('pdfToolsOptPasswordConfirm')))).toBe(
      en('pdfToolsPasswordMismatch'),
    )
    await type(field(sheet(), en('pdfToolsOptPasswordConfirm')), 'Op3n-Sesame')
    await click(control(sheet(), en('pdfToolsOptRestrict')))
    await type(field(sheet(), en('pdfToolsOptPermissionPassword')), 'Ch4nge-Me')
    await click(button(en('pdfToolsStart')))
    expect(runs).toHaveLength(1)
    expect(runs[0]!.options).toEqual({
      password: 'Op3n-Sesame',
      restrict: true,
      permissionPassword: 'Ch4nge-Me',
    })
    await act(async () => runs[0]!.resolve({ ok: false, reason: 'failed' }))
    await flush()
    // back on the options: nothing typed is left
    expect(field(sheet(), en('pdfToolsOptPassword')).value).toBe('')
    expect(field(sheet(), en('pdfToolsOptPasswordConfirm')).value).toBe('')
    const permission = field(sheet(), en('pdfToolsOptPermissionPassword'))
    expect(permission.value).toBe('')
    expect(document.body.innerHTML).not.toContain('Op3n-Sesame')
    expect(document.body.innerHTML).not.toContain('Ch4nge-Me')
    // typed once only, the password does not run: the repeat field is empty, not missing
    await type(field(sheet(), en('pdfToolsOptPassword')), 'Op3n-Sesame')
    await type(field(sheet(), en('pdfToolsOptPermissionPassword')), 'Ch4nge-Me')
    await click(button(en('pdfToolsStart')))
    expect(runs).toHaveLength(1)
    expect(errorOf(field(sheet(), en('pdfToolsOptPasswordConfirm')))).toBe(
      en('pdfToolsPasswordMismatch'),
    )
    const text = logged(spies)
    expect(text).not.toContain('Op3n-Sesame')
    expect(text).not.toContain('Ch4nge-Me')
  })

  it('decrypt: clears the password after a run that ends with a result too', async () => {
    const spies = consoleSpies()
    const { runs, sheet } = await toOptions('decrypt')
    await type(field(sheet(), en('pdfToolsOptCurrentPassword')), 'K3y-0f-Mine')
    await click(button(en('pdfToolsStart')))
    expect(runs[0]!.options).toEqual({ password: 'K3y-0f-Mine' })
    await act(async () => runs[0]!.resolve({ ok: false, reason: 'wrong-password' }))
    await flush()
    expect(field(sheet(), en('pdfToolsOptCurrentPassword')).value).toBe('')
    await type(field(sheet(), en('pdfToolsOptCurrentPassword')), 'K3y-0f-Mine')
    await click(button(en('pdfToolsStart')))
    await act(async () =>
      runs[1]!.resolve({
        ok: true,
        files: [{ name: 'a-unlocked.pdf', mime: 'application/pdf', bytes: new Uint8Array(3) }],
      }),
    )
    await flush()
    expect(document.body.querySelector('[data-testid="pdf-tools-result-sheet"]')).not.toBeNull()
    expect(document.body.innerHTML).not.toContain('K3y-0f-Mine')
    expect(logged(spies)).not.toContain('K3y-0f-Mine')
  })
})
