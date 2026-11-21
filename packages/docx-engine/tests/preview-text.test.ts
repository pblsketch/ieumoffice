import { describe, expect, it } from 'vitest'
import { plainText, previewText } from '../src/parse-xml-text'

describe('plainText (structural, tab/break-blind)', () => {
  it('still drops tabs, breaks and no-break hyphens', () => {
    expect(
      plainText(
        '<w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>World</w:t></w:r></w:p>',
      ),
    ).toBe('HelloWorld')
    expect(plainText('<w:r><w:t>Hello</w:t><w:br/><w:t>World</w:t></w:r>')).toBe('HelloWorld')
    expect(plainText('<w:r><w:t>pre</w:t><w:noBreakHyphen/><w:t>fix</w:t></w:r>')).toBe('prefix')
  })

  it('still inserts a space at table cell boundaries', () => {
    expect(
      plainText(
        '<w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc>',
      ),
    ).toBe('A B')
  })
})

describe('previewText tabs, breaks and hyphens (display-only)', () => {
  it('keeps a character tab between runs instead of gluing the words', () => {
    expect(
      previewText(
        '<w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>World</w:t></w:r></w:p>',
      ),
    ).toBe('Hello\tWorld')
  })

  it('does not turn tab-stop definitions in w:tabs into extra characters', () => {
    expect(
      previewText(
        '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="1440"/><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr>' +
          '<w:r><w:t>Name</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>Title</w:t></w:r></w:p>',
      ),
    ).toBe('Name\tTitle')
  })

  it('keeps a soft line break as a newline, but not page or column breaks', () => {
    expect(previewText('<w:r><w:t>Hello</w:t><w:br/><w:t>World</w:t></w:r>')).toBe('Hello\nWorld')
    expect(previewText('<w:r><w:t>Hello</w:t><w:cr/><w:t>World</w:t></w:r>')).toBe('Hello\nWorld')
    expect(previewText('<w:r><w:t>Hello</w:t><w:br w:type="page"/><w:t>World</w:t></w:r>')).toBe(
      'HelloWorld',
    )
    expect(previewText('<w:r><w:t>Hello</w:t><w:br w:type="column"/><w:t>World</w:t></w:r>')).toBe(
      'HelloWorld',
    )
  })

  it('renders a no-break hyphen as a hyphen so split words stay readable', () => {
    expect(previewText('<w:r><w:t>pre</w:t><w:noBreakHyphen/><w:t>fix</w:t></w:r>')).toBe('pre-fix')
  })

  it('still inserts a space at table cell boundaries', () => {
    expect(
      previewText(
        '<w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc>',
      ),
    ).toBe('A B')
  })

  it('does not count a tab, break or hyphen that lives inside a tracked deletion', () => {
    // a deleted run can carry a deleted <w:tab/>/<w:br/>/<w:noBreakHyphen/> (w:delText
    // stands in for w:t, but the deleted field/break markup is unchanged); none of
    // it is visible in Word, so none of it should surface in the preview either
    expect(
      previewText(
        '<w:r><w:t>Hello</w:t></w:r>' +
          '<w:del w:id="1"><w:r><w:tab/><w:delText>deleted</w:delText><w:br/></w:r></w:del>' +
          '<w:r><w:t>World</w:t></w:r>',
      ),
    ).toBe('HelloWorld')
  })
})
