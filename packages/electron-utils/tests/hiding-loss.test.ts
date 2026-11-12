import { describe, expect, it, vi } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import {
  HIDING_LOSS_STRINGS,
  confirmHidingLoss,
  countHtmlHidingMarks,
  countMarkedSpans,
  hidingLossMessageBox,
} from '../src/hiding-loss'

describe('the question before a conversion that loses hiding marks', () => {
  it('says how many and offers Continue and Cancel, Cancel by default', () => {
    const box = hidingLossMessageBox(3, 'ko')
    expect(box.message).toBe(
      '가리기 3곳이 빠집니다. 바꾼 문서에서는 그 글이 AI에게 보일 수 있습니다.',
    )
    expect(box.buttons).toEqual(['계속', '취소'])
    expect(box.defaultId).toBe(1)
    expect(box.cancelId).toBe(1)
  })

  it('is worded in every screen language, with the count in it', () => {
    for (const lang of LANGS) {
      expect(Object.keys(HIDING_LOSS_STRINGS[lang]).sort(), lang).toEqual(
        Object.keys(HIDING_LOSS_STRINGS.zh).sort(),
      )
      expect(hidingLossMessageBox(7, lang).message, lang).toContain('7')
    }
  })

  it('does not ask when nothing hidden is lost', async () => {
    const show = vi.fn()
    expect(await confirmHidingLoss(0, show, 'en')).toBe(true)
    expect(show).not.toHaveBeenCalled()
  })

  it('asks once; Continue goes on, Cancel stops', async () => {
    const yes = vi.fn(async () => ({ response: 0 }))
    expect(await confirmHidingLoss(2, yes, 'en')).toBe(true)
    expect(yes).toHaveBeenCalledTimes(1)
    const no = vi.fn(async () => ({ response: 1 }))
    expect(await confirmHidingLoss(2, no, 'en')).toBe(false)
    expect(no).toHaveBeenCalledTimes(1)
  })
})

describe('counting hidden spans', () => {
  const mark = (label: string) => ({ type: 'redaction', attrs: { label } })
  it('counts touching text of one label in one block once', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '이름 ' },
            { type: 'text', text: '홍길', marks: [mark('이름')] },
            { type: 'text', text: '동', marks: [{ type: 'bold' }, mark('이름')] },
            { type: 'text', text: ' 전화 ' },
            { type: 'text', text: '010', marks: [mark('전화')] },
            { type: 'text', text: '-1234', marks: [mark('주소')] },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: '다음', marks: [mark('이름')] }] },
        { type: 'paragraph', content: [{ type: 'text', text: '없음' }] },
      ],
    }
    expect(countMarkedSpans(doc, 'redaction')).toBe(4)
    expect(countMarkedSpans({ type: 'doc', content: [] }, 'redaction')).toBe(0)
  })

  it('counts the HTML editor marks in any case', () => {
    expect(countHtmlHidingMarks('<p>plain</p>')).toBe(0)
    expect(
      countHtmlHidingMarks(
        '<p data-gx-redact="이름">a</p><img DATA-GX-REDACT-SRC="그림"><script>/*gx:redact:키*/"x"</script>',
      ),
    ).toBe(3)
  })
})
