import { describe, expect, it } from 'vitest'
import type { MobileDocFormat } from '@genoffice/mobile-bridge/transport'
import { EDITOR_KINDS, findEditorKind, openableExtensions } from '../src/renderer/editors/registry'
import { hwpEditorKind } from '../src/renderer/editors/hwpKind'
import { markdownEditorKind } from '../src/renderer/editors/markdownKind'

describe('the editor registry', () => {
  it('finds the HWP kind for .hwp and .hwpx', () => {
    expect(findEditorKind('hwp')).toBe(hwpEditorKind)
    expect(findEditorKind('hwpx')).toBe(hwpEditorKind)
    expect(hwpEditorKind.id).toBe('hwp')
  })

  it('finds the Markdown kind for .md and .txt', () => {
    expect(findEditorKind('md')).toBe(markdownEditorKind)
    expect(findEditorKind('txt')).toBe(markdownEditorKind)
    expect(markdownEditorKind.id).toBe('markdown')
  })

  it('leaves the formats the tracks register to the tracks', () => {
    // the HWP and Markdown kinds never claim them; a track's own kind may (or none yet)
    const trackFormats: MobileDocFormat[] = [
      'pdf',
      'html',
      'xlsx',
      'xlsm',
      'xls',
      'csv',
      'epub',
      'pptx',
    ]
    for (const format of trackFormats) {
      expect(findEditorKind(format)).not.toBe(hwpEditorKind)
      expect(findEditorKind(format)).not.toBe(markdownEditorKind)
    }
  })

  it('opens the extensions the picker offered before the registry first, without repeats', () => {
    const exts = openableExtensions()
    expect(exts.slice(0, 5)).toEqual(['hwp', 'hwpx', 'md', 'markdown', 'txt'])
    expect(new Set(exts).size).toBe(exts.length)
  })

  it('lets no two kinds claim the same format', () => {
    const seen = new Map<MobileDocFormat, string>()
    for (const kind of EDITOR_KINDS) {
      for (const format of kind.formats) {
        expect(seen.get(format), `${format} claimed by ${seen.get(format)} and ${kind.id}`).toBe(
          undefined,
        )
        seen.set(format, kind.id)
      }
    }
  })

  it('keeps the HWP kind as it was and the Markdown recovery rule', () => {
    expect(hwpEditorKind.createFormats).toEqual(['hwp', 'hwpx'])
    expect(hwpEditorKind.editable).toBe(true)
    expect(hwpEditorKind.hasAi).toBe(true)
    expect(hwpEditorKind.recoveryFormat('hwp')).toBe('hwp')
    expect(hwpEditorKind.recoveryFormat('hwpx')).toBe('hwpx')

    // the Markdown kind belongs to T4 after S0; only the recovery rule is pinned here
    // a .txt recovery copy reopens as an untitled Markdown document, as before
    expect(markdownEditorKind.recoveryFormat('md')).toBe('md')
    expect(markdownEditorKind.recoveryFormat('txt')).toBe('md')
  })
})
