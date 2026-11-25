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

  it('has no kind yet for the formats the tracks will register', () => {
    const unregistered: MobileDocFormat[] = [
      'pdf',
      'html',
      'xlsx',
      'xlsm',
      'xls',
      'csv',
      'epub',
      'pptx',
    ]
    for (const format of unregistered) expect(findEditorKind(format)).toBeNull()
  })

  it('opens exactly the extensions the picker offered before the registry', () => {
    expect(openableExtensions()).toEqual(['hwp', 'hwpx', 'md', 'markdown', 'txt'])
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

  it('keeps the current create, edit, AI and recovery behavior of the two kinds', () => {
    expect(hwpEditorKind.createFormats).toEqual(['hwp', 'hwpx'])
    expect(hwpEditorKind.editable).toBe(true)
    expect(hwpEditorKind.hasAi).toBe(true)
    expect(hwpEditorKind.recoveryFormat('hwp')).toBe('hwp')
    expect(hwpEditorKind.recoveryFormat('hwpx')).toBe('hwpx')

    expect(markdownEditorKind.createFormats).toEqual(['md'])
    expect(markdownEditorKind.editable).toBe(true)
    expect(markdownEditorKind.hasAi).toBe(true)
    // a .txt recovery copy reopens as an untitled Markdown document, as before
    expect(markdownEditorKind.recoveryFormat('md')).toBe('md')
    expect(markdownEditorKind.recoveryFormat('txt')).toBe('md')
  })
})
