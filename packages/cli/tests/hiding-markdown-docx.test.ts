import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { REDACT_EL, REDACT_NS } from '@genoffice/agent-core/redact-range'
import { run, tempDir } from './helpers'

/**
 * Markdown → Word on the command line (`convert --to docx`, `create --type docx
 * --from`) goes through the markdown editor's own Word exporter, so a hidden
 * span (민감정보 가리기) becomes the Word editor's hiding mark: the copy stays
 * hidden wherever it is read next, `docs read` included.
 */

const SECRET = 'SECRETNAME'
const LABEL = '학생 이름'

describe('a Markdown hidden span becomes a Word hiding mark', () => {
  it('through convert and create', async () => {
    const dir = tempDir()
    const md = join(dir, 'a.md')
    writeFileSync(
      md,
      `call <span class="redact-span" data-redaction="" data-label="${LABEL}">${SECRET}</span> now\n`,
    )
    for (const argv of [
      ['convert', md, '--to', 'docx', '--out', join(dir, 'converted.docx')],
      ['create', '--type', 'docx', '--from', md, '--out', join(dir, 'created.docx')],
    ]) {
      const out = argv[argv.length - 1]!
      const r = await run([...argv, '--json'])
      expect(r.code, argv[0]).toBe(0)
      const xml = await (
        await JSZip.loadAsync(readFileSync(out))
      )
        .file('word/document.xml')!
        .async('string')
      expect(xml).toContain(`<${REDACT_EL} w:label="${LABEL}"/>`)
      expect(xml).toContain(`xmlns:go="${REDACT_NS}"`)
      const read = await run(['docs', 'read', out, '--json'])
      expect(read.stdout).not.toContain(SECRET)
      expect(read.json().detail.items[0].text).toBe(`call {{${LABEL}}} now`)
    }
  })
})
