import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { findEditorKind, openableExtensions } from '../src/renderer/editors/registry'
import { readersEditorKinds } from '../src/renderer/editors/readers'
import { epubEditorKind } from '../src/renderer/editors/readers/epub/epubKind'
import { pptxEditorKind } from '../src/renderer/editors/readers/pptx/pptxKind'

const HERE = dirname(fileURLToPath(import.meta.url))
const nativeConfig = (path: string) => readFileSync(join(HERE, '../native-config', path), 'utf8')

describe('the T5 reader kinds in the registry', () => {
  it('registers the EPUB and PPTX readers in that order', () => {
    expect(readersEditorKinds).toEqual([epubEditorKind, pptxEditorKind])
    expect(findEditorKind('epub')).toBe(epubEditorKind)
    expect(findEditorKind('pptx')).toBe(pptxEditorKind)
  })

  it('declares both as read-only kinds without AI, saving or new documents', () => {
    expect(epubEditorKind).toMatchObject({
      id: 'epub',
      formats: ['epub'],
      openExtensions: ['epub'],
      editable: false,
      hasAi: false,
      labelKey: 'readersEpubKindLabel',
    })
    expect(pptxEditorKind).toMatchObject({
      id: 'pptx',
      formats: ['pptx'],
      openExtensions: ['pptx'],
      editable: false,
      hasAi: false,
      labelKey: 'readersPptxKindLabel',
    })
    for (const kind of readersEditorKinds) {
      expect(kind.createFormats).toBeUndefined()
      expect(kind.recoveryFormat(kind.formats[0]!)).toBe(kind.formats[0])
    }
  })

  it('lets the picker and the open gate offer .epub and .pptx', () => {
    const exts = openableExtensions()
    expect(exts).toContain('epub')
    expect(exts).toContain('pptx')
  })

  it('declares the reader MIME types under the T5 marker in both Android filters', () => {
    const xml = nativeConfig('android/intent-filters-fragment.xml')
    const blocks = xml.split('<!-- T5 readers MIME types -->').slice(1)
    expect(blocks).toHaveLength(2)
    for (const block of blocks) {
      const own = block.split('</intent-filter>')[0]!
      expect(own).toContain('android:mimeType="application/epub+zip"')
      expect(own).toContain(
        'android:mimeType="application/vnd.openxmlformats-officedocument.presentationml.presentation"',
      )
    }
  })

  it('declares the reader document types under the T5 marker on iOS, as a viewer', () => {
    const plist = nativeConfig('ios/Info-fragment.plist')
    const own = plist.split('<!-- T5 readers document types -->')[1]!.split('</array>\n  <key>')[0]!
    expect(own).toContain('<string>org.idpf.epub-container</string>')
    expect(own).toContain('<string>org.openxmlformats.presentationml.presentation</string>')
    expect(own.match(/<string>Viewer<\/string>/g)).toHaveLength(2)
  })
})
