import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { attachFrameGuards } from '../src/renderer/editors/html/HtmlPreviewFrame'
import {
  PREVIEW_CSP,
  PREVIEW_SANDBOX,
  SID_ATTR,
  buildPreviewCopy,
  hasDocumentScript,
  mapDocument,
} from '../src/renderer/editors/html/htmlPreview'

const PAGE = [
  '<!DOCTYPE html>',
  '<html lang="ko">',
  '<head>',
  '  <meta charset="UTF-8">',
  '  <title>보고서</title>',
  '</head>',
  '<body>',
  '  <h1>제목</h1>',
  '  <p>문단 <a href="https://example.com/">링크</a></p>',
  '  <script>document.body.textContent = "x"</script>',
  '</body>',
  '</html>',
  '',
].join('\n')

function copyOf(source: string): string {
  return buildPreviewCopy(source, mapDocument(source, 0, null))
}

function cspIndex(copy: string): number {
  return copy.indexOf('<meta http-equiv="Content-Security-Policy"')
}

describe('the HTML preview copy', () => {
  it('puts the CSP first in <head> with the exact policy', () => {
    const copy = copyOf(PAGE)
    expect(PREVIEW_CSP).toBe(
      "script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'",
    )
    expect(copy).toContain(`content="${PREVIEW_CSP}"`)
    const head = /<head\b[^>]*>/.exec(copy)
    expect(head).not.toBeNull()
    expect(cspIndex(copy)).toBe(head!.index + head![0].length)
    // only one policy
    expect(copy.split('Content-Security-Policy').length).toBe(2)
  })

  it('puts the CSP after the doctype when there is no <head>, else at the start', () => {
    const noHead = '<!doctype html>\n<p>글</p>'
    const copy = copyOf(noHead)
    expect(copy.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"')).toBe(true)
    expect(copyOf('<p>글</p>').startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true)
    // the policy sits before every element of the document
    const parsed = new DOMParser().parseFromString(copy, 'text/html')
    expect(parsed.head.firstElementChild?.getAttribute('http-equiv')).toBe(
      'Content-Security-Policy',
    )
  })

  it('gives every element a data-gx-sid, as the desktop instrumenter does, and no inspector script', () => {
    const copy = copyOf(PAGE)
    const parsed = new DOMParser().parseFromString(copy, 'text/html')
    for (const tag of ['html', 'head', 'body', 'h1', 'p', 'a', 'title', 'script']) {
      const el = parsed.querySelector(tag)
      expect(el?.getAttribute(SID_ATTR), tag).toMatch(/^\d+$/)
    }
    expect(copy).not.toContain('data-gx-inspector')
    // the document's own script stays as it is (the CSP and the sandbox keep it from running)
    expect(parsed.querySelectorAll('script')).toHaveLength(1)
  })

  it('keeps the rest of the source as it is', () => {
    const copy = copyOf(PAGE)
    const stripped = copy
      .replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/, '')
      .replace(/ data-gx-sid="\d+"/g, '')
    expect(stripped).toBe(PAGE)
  })

  it('replaces a data-gx-sid the author wrote', () => {
    const copy = copyOf('<p data-gx-sid="999">a</p>')
    expect(copy).not.toContain('data-gx-sid="999"')
    expect(copy.match(/data-gx-sid=/g)).toHaveLength(1)
  })

  it('takes away the effect of a meta refresh in the copy only', () => {
    const source = '<head><meta http-equiv="refresh" content="0;url=https://example.com"></head>'
    const copy = copyOf(source)
    expect(copy).not.toMatch(/\shttp-equiv\s*=\s*"refresh"/i)
    expect(source).toContain('http-equiv="refresh"')
  })

  it.each([
    ['a slash before the attribute', '<meta/http-equiv="refresh" content="0;url=https://e.com">'],
    ['a ">" in an earlier quoted value', '<meta content="a>b" http-equiv=refresh>'],
    ['upper case and spaces', "<META HTTP-EQUIV = ' Refresh ' content='0'>"],
  ])('takes away a meta refresh spelled with %s', (_name, tag) => {
    const copy = copyOf(`<head>${tag}</head><p>a</p>`)
    const metas = copy.match(/<meta(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? []
    const refresh = metas.filter((m) =>
      /(?:^|[\s/])http-equiv\s*=\s*["']?\s*refresh/i.test(m.slice(5)),
    )
    expect(refresh).toHaveLength(0)
    // the copy's own policy tag keeps working
    expect(copy).toContain('<meta http-equiv="Content-Security-Policy"')
  })

  it('tells whether the source has a script element', () => {
    expect(hasDocumentScript(mapDocument(PAGE, 0, null))).toBe(true)
    expect(hasDocumentScript(mapDocument('<!-- <script> --><p>a</p>', 0, null))).toBe(false)
  })

  it('uses a sandbox without scripts, and no HTML editor file grants them', () => {
    expect(PREVIEW_SANDBOX).toBe('allow-same-origin')
    const folder = resolve(dirname(fileURLToPath(import.meta.url)), '../src/renderer/editors/html')
    const files = readdirSync(folder, { recursive: true, encoding: 'utf8' }).filter((name) =>
      /\.(ts|tsx)$/.test(name),
    )
    expect(files.length).toBeGreaterThan(0)
    for (const name of files) {
      const text = readFileSync(join(folder, name), 'utf8')
      expect(text, name).not.toMatch(/allow-(scripts|forms|popups|top-navigation)/)
    }
  })
})

describe('the frame guards', () => {
  function frameDoc(html: string): Document {
    return new DOMParser().parseFromString(html, 'text/html')
  }

  it('stops a link press from moving the frame', () => {
    const doc = frameDoc('<p><a href="https://example.com/"><b>링크</b></a> 글</p>')
    attachFrameGuards(doc)
    const inner = doc.querySelector('b')!
    const press = new MouseEvent('click', { bubbles: true, cancelable: true })
    inner.dispatchEvent(press)
    expect(press.defaultPrevented).toBe(true)

    const text = new MouseEvent('click', { bubbles: true, cancelable: true })
    doc.querySelector('p')!.dispatchEvent(text)
    expect(text.defaultPrevented).toBe(false)
  })

  it('stops a form from submitting and reports the element pressed', () => {
    const doc = frameDoc(
      `<form action="https://example.com/"><p ${SID_ATTR}="7"><span>x</span></p></form>`,
    )
    const pressed: Array<number | null> = []
    const detach = attachFrameGuards(doc, (sid) => pressed.push(sid))
    const submit = new Event('submit', { bubbles: true, cancelable: true })
    doc.querySelector('form')!.dispatchEvent(submit)
    expect(submit.defaultPrevented).toBe(true)
    doc.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(pressed).toEqual([7])

    detach()
    const after = new MouseEvent('click', { bubbles: true, cancelable: true })
    doc.querySelector('span')!.dispatchEvent(after)
    expect(pressed).toEqual([7])
  })
})
