/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SensitiveCandidateList,
  SensitiveFindButton,
  SensitiveLabelDialog,
  SensitiveSendAlert,
} from '../src/SensitiveInfo'
import {
  useSensitiveSendAlert,
  type SensitiveSendAlertController,
} from '../src/use-sensitive-send-alert'
import { sensitiveContextOf, type SensitiveCandidateRow } from '../src/sensitive-candidates'
import { sensitiveInfoText } from '../src/strings-sensitive-info'

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

const flush = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => await Promise.resolve())
}
const buttons = () => [...host.querySelectorAll('button')]
const button = (label: string) => buttons().find((b) => b.textContent === label)
const click = (el: Element | undefined) => {
  if (!el) throw new Error('missing element')
  act(() => (el as HTMLElement).click())
}
const ko = (
  key: Parameters<typeof sensitiveInfoText>[1],
  params?: Record<string, number | string>,
) => sensitiveInfoText('ko', key, params)

const rows: SensitiveCandidateRow[] = [
  {
    id: 'a',
    kind: 'phone',
    value: '010-1234-5678',
    before: '연락처: ',
    after: ' (집)',
    location: '2쪽',
    label: '전화-01',
    hideable: true,
  },
  {
    id: 'b',
    kind: 'name',
    value: '김철수',
    before: '담임 ',
    after: '',
    location: '머리말',
    label: '이름-01',
    hideable: false,
    reason: 'header-footer',
  },
  {
    id: 'c',
    kind: 'email',
    value: 'kim@example.com',
    location: '3쪽',
    label: '이메일-01',
    hideable: true,
  },
  {
    id: 'd',
    kind: 'name',
    value: '이영희',
    location: '4쪽',
    label: '이름-02',
    hideable: false,
    reason: 'memo-overlap',
  },
]

function renderList(props: Partial<Parameters<typeof SensitiveCandidateList>[0]> = {}) {
  const onConfirm = vi.fn()
  const onExclude = vi.fn()
  const onLocate = vi.fn()
  act(() =>
    root.render(
      createElement(SensitiveCandidateList, {
        lang: 'ko',
        candidates: rows,
        onConfirm,
        onExclude,
        onLocate,
        ...props,
      }),
    ),
  )
  return { onConfirm, onExclude, onLocate }
}
const row = (id: string) => host.querySelector<HTMLLIElement>(`.gs-sens-row[data-id="${id}"]`)!
const rowButton = (id: string, label: string) =>
  [...row(id).querySelectorAll('button')].find((b) => b.textContent === label)

describe('SensitiveCandidateList', () => {
  it('shows kind, context, location and the proposed label of each row', () => {
    renderList()
    const a = row('a')
    expect(a.querySelector('.gs-sens-kind')?.textContent).toBe('전화')
    expect(a.querySelector('.gs-sens-context')?.textContent).toBe('연락처: 010-1234-5678 (집)')
    expect(a.querySelector('.gs-sens-value')?.textContent).toBe('010-1234-5678')
    expect(a.querySelector('.gs-sens-loc')?.textContent).toBe('2쪽')
    expect(a.querySelector('.gs-sens-label')?.textContent).toBe('{{전화-01}}')
  })

  it('counts the spots that cannot be hidden, and keeps their confirm button off', () => {
    const { onConfirm } = renderList()
    expect(host.querySelector('.gs-sens-count')?.textContent).toBe(
      `${ko('listCount', { n: 4 })} · ${ko('listUnhideableCount', { n: 2 })}`,
    )
    const hide = rowButton('b', ko('confirm'))!
    expect(hide.disabled).toBe(true)
    click(hide)
    expect(onConfirm).not.toHaveBeenCalled()
    expect(row('b').querySelector('.gs-sens-unhideable')?.textContent).toContain(
      '이 자리는 가릴 수 없음(머리말·꼬리말)',
    )
    expect(row('d').textContent).toContain('이 자리는 가릴 수 없음(메모와 겹침)')
    expect(row('b').querySelector('.gs-sens-label')).toBeNull()
  })

  it('confirms one row, excludes a row and locates a row', () => {
    const { onConfirm, onExclude, onLocate } = renderList()
    click(rowButton('a', ko('confirm')))
    expect(onConfirm).toHaveBeenCalledWith(['a'])
    click(rowButton('b', ko('exclude')))
    expect(onExclude).toHaveBeenCalledWith('b')
    click(row('c').querySelector('button.gs-sens-context')!)
    expect(onLocate).toHaveBeenCalledWith('c')
  })

  it('"hide all" asks first and then confirms only the rows that can be hidden', () => {
    const { onConfirm } = renderList()
    click(button(ko('confirmAll')))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(host.querySelector('.gs-sens-ask')?.textContent).toContain(ko('confirmAllAsk', { n: 2 }))
    click(host.querySelector('.gs-sens-ask button.primary')!)
    expect(onConfirm).toHaveBeenCalledWith(['a', 'c'])
  })

  it('"hide all" can be cancelled without changing anything', () => {
    const { onConfirm } = renderList()
    click(button(ko('confirmAll')))
    click(button(ko('cancel')))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(host.querySelector('.gs-sens-ask')).toBeNull()
  })

  it('a word processor sees how many memos "hide all" adds', () => {
    renderList({ memoNote: true })
    click(button(ko('confirmAll')))
    expect(host.querySelector('.gs-sens-ask')?.textContent).toContain(
      '메모 2개가 생기고, 문서를 받는 사람에게도 보입니다.',
    )
  })

  it('"hide all" is off when no row can be hidden', () => {
    renderList({ candidates: rows.filter((r) => !r.hideable) })
    expect(button(ko('confirmAll'))?.disabled).toBe(true)
  })

  it('tells the person to open an attachment to hide what was found in it', () => {
    renderList({ attachmentCount: 3 })
    expect(host.querySelector('.gs-sens-attachments')?.textContent).toBe(
      ko('attachmentsHint', { n: 3 }),
    )
  })

  it('shows the empty and the busy state', () => {
    renderList({ candidates: [] })
    expect(host.querySelector('.gs-sens-empty')?.textContent).toBe(ko('listEmpty'))
    renderList({ busy: true })
    expect(host.querySelector('.gs-sens-empty')?.textContent).toBe(ko('findBusy'))
    expect(host.querySelector('.gs-sens-rows')).toBeNull()
  })

  it('states that the finder runs on this PC without AI', () => {
    renderList()
    expect(host.textContent).toContain(ko('listRulesNote'))
  })
})

describe('sensitiveContextOf', () => {
  it('cuts the surrounding text to a few characters with an ellipsis', () => {
    const text = '이 문서의 담당 교사는 김철수 선생님이고 연락은 학교로 하세요'
    const start = text.indexOf('김철수')
    expect(sensitiveContextOf(text, start, start + 3, 5)).toEqual({
      before: '… 교사는 ',
      after: ' 선생님이…',
    })
    expect(sensitiveContextOf('김철수\n선생님', 0, 3, 5)).toEqual({ before: '', after: ' 선생님' })
  })
})

describe('SensitiveSendAlert', () => {
  function renderAlert(localAi: boolean, attachmentCount = 0) {
    const onReview = vi.fn()
    const onSend = vi.fn()
    act(() =>
      root.render(
        createElement(SensitiveSendAlert, {
          lang: 'ko',
          counts: { documentCount: 3, attachmentCount },
          localAi,
          onReview,
          onSend,
        }),
      ),
    )
    return { onReview, onSend }
  }

  it('shows the counts of this document and the attachments', () => {
    renderAlert(false, 2)
    expect(host.querySelector('.gs-sens-alert-counts')?.textContent).toBe(
      '민감정보로 보이는 것: 이 문서 3개, 첨부 2개',
    )
    renderAlert(false, 0)
    expect(host.querySelector('.gs-sens-alert-counts')?.textContent).toBe(
      '민감정보로 보이는 것: 이 문서 3개',
    )
  })

  it('says "the AI on this PC" for a local AI, and only then', () => {
    renderAlert(true)
    expect(host.querySelector('.gs-sens-alert-body')?.textContent).toBe(ko('alertBodyLocal'))
    expect(host.textContent).toContain('이 PC 안의 AI')
    renderAlert(false)
    expect(host.querySelector('.gs-sens-alert-body')?.textContent).toBe(ko('alertBody'))
    expect(host.textContent).not.toContain('이 PC 안의 AI')
  })

  it('puts focus on "review", so Enter never sends', () => {
    renderAlert(false)
    expect(document.activeElement?.textContent).toBe('확인하기')
  })
})

describe('useSensitiveSendAlert', () => {
  let ctl: SensitiveSendAlertController
  function Panel({ localAi = false }: { localAi?: boolean }) {
    ctl = useSensitiveSendAlert({ lang: 'ko', localAi })
    return createElement('div', null, ctl.alert)
  }
  const mount = (localAi = false) => act(() => root.render(createElement(Panel, { localAi })))

  /** the editor's send path: nothing goes out unless the answer is `send` */
  function editor() {
    const sent: string[] = []
    const openedList = vi.fn()
    let composer = ''
    return {
      sent,
      openedList,
      type(text: string) {
        composer = text
      },
      get composer() {
        return composer
      },
      async send(counts = { documentCount: 2, attachmentCount: 1 }) {
        const answer = await ctl.beforeSend(() => counts)
        if (answer === 'review') {
          openedList()
          return
        }
        sent.push(composer)
        composer = ''
      },
    }
  }

  it('"review" sends nothing, keeps the composer text and is not asked again', async () => {
    mount()
    const ed = editor()
    ed.type('학생 명단 정리해 줘')
    let done = false
    void ed.send().then(() => (done = true))
    await flush()
    expect(host.querySelector('.gs-sens-alert')).not.toBeNull()
    expect(host.textContent).toContain('이 문서 2개, 첨부 1개')
    click(button('확인하기'))
    await flush()
    expect(done).toBe(true)
    expect(ed.sent).toEqual([])
    expect(ed.composer).toBe('학생 명단 정리해 줘')
    expect(ed.openedList).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.gs-sens-alert')).toBeNull()

    await act(async () => await ed.send())
    expect(host.querySelector('.gs-sens-alert')).toBeNull()
    expect(ed.sent).toEqual(['학생 명단 정리해 줘'])
  })

  it('"send anyway" sends, and the tab is not asked again', async () => {
    mount(true)
    const ed = editor()
    ed.type('요약해 줘')
    void ed.send()
    await flush()
    expect(host.textContent).toContain('이 PC 안의 AI')
    click(button('그냥 보내기'))
    await flush()
    expect(ed.sent).toEqual(['요약해 줘'])
    ed.type('다시')
    await act(async () => await ed.send())
    expect(host.querySelector('.gs-sens-alert')).toBeNull()
    expect(ed.sent).toEqual(['요약해 줘', '다시'])
  })

  it('nothing found: the first send goes out without an alert', async () => {
    mount()
    const ed = editor()
    ed.type('안녕')
    await act(async () => await ed.send({ documentCount: 0, attachmentCount: 0 }))
    expect(host.querySelector('.gs-sens-alert')).toBeNull()
    expect(ed.sent).toEqual(['안녕'])
  })

  it('a panel closed with the alert open sends nothing', async () => {
    mount()
    const ed = editor()
    ed.type('비밀')
    let done = false
    void ed.send().then(() => (done = true))
    await flush()
    expect(host.querySelector('.gs-sens-alert')).not.toBeNull()
    act(() => root.render(createElement('div')))
    await flush()
    expect(done).toBe(true)
    expect(ed.sent).toEqual([])
    expect(ed.openedList).toHaveBeenCalledTimes(1)
    expect(ctl.check.settled).toBe(false)
  })
})

describe('SensitiveFindButton', () => {
  it('opens the list, and is busy while finding', () => {
    const onClick = vi.fn()
    act(() => root.render(createElement(SensitiveFindButton, { lang: 'ko', onClick })))
    click(button('민감정보 찾기'))
    expect(onClick).toHaveBeenCalledTimes(1)
    act(() => root.render(createElement(SensitiveFindButton, { lang: 'ko', onClick, busy: true })))
    const b = buttons()[0]!
    expect(b.textContent).toBe(ko('findBusy'))
    expect(b.disabled).toBe(true)
  })
})

describe('SensitiveLabelDialog', () => {
  function renderDialog(memoCount?: number) {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    act(() =>
      root.render(
        createElement(SensitiveLabelDialog, {
          lang: 'ko',
          seed: '학생 이름',
          onSubmit,
          onCancel,
          memoCount,
        }),
      ),
    )
    return { onSubmit, onCancel }
  }

  it('is titled with the feature name and says the file keeps the words', () => {
    renderDialog()
    expect(host.querySelector('.gs-sens-dialog-title')?.textContent).toBe('민감정보 가리기')
    expect(host.querySelector('.gs-sens-dialog-desc')?.textContent).toBe(
      '고른 부분은 AI에게 보내지 않습니다. 파일에는 그대로 남습니다.',
    )
    expect(host.querySelector('.gs-sens-label')?.textContent).toBe('{{학생 이름}}')
  })

  it('submits the label, and Escape cancels once', () => {
    const { onSubmit, onCancel } = renderDialog()
    click(host.querySelector('.gs-sens-dialog button.primary')!)
    expect(onSubmit).toHaveBeenCalledWith('학생 이름')
    const input = host.querySelector('input')!
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('shows the memo note only when more than one memo is added', () => {
    renderDialog(1)
    expect(host.textContent).not.toContain('메모 1개')
    renderDialog(3)
    expect(host.textContent).toContain('메모 3개가 생기고, 문서를 받는 사람에게도 보입니다.')
  })
})
