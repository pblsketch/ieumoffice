import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocumentProfile } from '@genoffice/doc-rules'
import { DocCheckSheet, REPLACEMENT_FONT } from '../src/renderer/components/DocCheckSheet'
import { MobileLocaleProvider } from '../src/renderer/i18n'

const containers: HTMLElement[] = []
afterEach(() => {
  while (containers.length > 0) containers.pop()?.remove()
})

/** A document whose text uses a font only the Korean word processor has. */
const PROFILE: DocumentProfile = {
  format: 'hwp',
  charShapes: [{ id: '1', fonts: ['HY헤드라인M'], uses: 3, first: { section: 0, para: 0 } }],
  paragraphs: [{ index: 0, section: 0, text: '제목' }],
  tables: [],
  pictures: [],
}

async function render(props: Partial<Parameters<typeof DocCheckSheet>[0]>) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  containers.push(el)
  await act(async () => {
    createRoot(el).render(
      <MobileLocaleProvider lang="ko">
        <DocCheckSheet
          open
          onClose={() => {}}
          format="hwp"
          readProfile={async () => PROFILE}
          onReveal={() => {}}
          {...props}
        />
      </MobileLocaleProvider>,
    )
  })
  return document.body
}

describe('DocCheckSheet', () => {
  it('lists a Korean-word-processor-only font, shows it and replaces it', async () => {
    const onReveal = vi.fn()
    const onReplaceFont = vi.fn(async () => {})
    const body = await render({ onReveal, onReplaceFont })
    const finding = [...body.querySelectorAll('.mobile-check-finding')].find((el) =>
      el.textContent?.includes('HY헤드라인M'),
    )!
    expect(finding).toBeDefined()
    const [place, fix] = finding.querySelectorAll<HTMLButtonElement>(
      '.mobile-check-place-row button',
    )
    act(() => place.click())
    expect(onReveal).toHaveBeenCalledWith(expect.objectContaining({ label: 'HY헤드라인M' }))
    await act(async () => fix.click())
    expect(onReplaceFont).toHaveBeenCalledWith('HY헤드라인M', REPLACEMENT_FONT)
  })

  it('says when the document could not be read', async () => {
    const body = await render({
      readProfile: async () => {
        throw new Error('no plugin')
      },
    })
    expect(body.querySelector('.mobile-memo-error')?.textContent).toBe('문서를 읽지 못했습니다.')
  })

  it('uses the id of the PC page editor plugin', () => {
    const plugin = readFileSync(join(__dirname, '../../hwp/studio-plugin/agent-plugin.mjs'), 'utf8')
    const mobile = readFileSync(
      join(__dirname, '../src/renderer/editors/HwpMobileEditor.tsx'),
      'utf8',
    )
    const id = /export const AGENT_PLUGIN_ID = '([^']+)'/.exec(plugin)?.[1]
    expect(id).toBeTruthy()
    expect(mobile).toContain(`const AGENT_PLUGIN_ID = '${id}'`)
  })
})
