import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMobileClient, type MobileTransport } from '@genoffice/mobile-bridge/transport'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { HomeFileRow, type HomeFileItem } from '../src/renderer/home/actions'
import { clearHomeThumbnailMemoryCache } from '../src/renderer/home/actions/useHomeThumbnail'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const containers: HTMLElement[] = []

beforeEach(() => {
  clearHomeThumbnailMemoryCache()
})

afterEach(() => {
  while (containers.length > 0) containers.pop()?.remove()
})

function makeItem(overrides: Partial<HomeFileItem> = {}): HomeFileItem {
  return {
    key: 'recent:r1',
    name: 'proposal.hwpx',
    format: 'hwpx',
    time: 1_700_000_000_000,
    favorite: false,
    groupId: null,
    fileRef: { kind: 'recent', id: 'r1' },
    ...overrides,
  }
}

function mockThumbClient(payload: unknown) {
  const transport: MobileTransport = {
    invoke: async <T,>(cmd: string): Promise<T> => {
      if (cmd === 'mobile_home_get_thumbnail') return payload as T
      return { ok: true } as T
    },
    listen: vi.fn(async () => () => {}),
  }
  return createMobileClient(transport)
}

async function flushMicrotasks() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10))
  })
}

describe('home file row document thumbnails', () => {
  it('renders the fallback format icon when no client is provided', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    containers.push(container)

    act(() => {
      createRoot(container).render(
        <MobileLocaleProvider lang="ko">
          <ul>
            <HomeFileRow
              item={makeItem()}
              selecting={false}
              selected={false}
              onOpen={() => {}}
              onToggleSelect={() => {}}
              onStartSelect={() => {}}
              onOpenMenu={() => {}}
            />
          </ul>
        </MobileLocaleProvider>,
      )
    })

    const thumb = container.querySelector('[data-testid="home-file-thumb-recent:r1"]')
    expect(thumb?.getAttribute('data-thumb-kind')).toBe('none')
    expect(container.querySelector('.home-act-thumb-img')).toBeNull()
  })

  it('renders an image thumbnail with format badge when backend returns an image payload', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    containers.push(container)
    const client = mockThumbClient({
      kind: 'image',
      mime: 'image/png',
      dataBase64: 'iVBORw0KGgo=',
    })

    act(() => {
      createRoot(container).render(
        <MobileLocaleProvider lang="ko">
          <ul className="mobile-doc-list" data-view="grid">
            <HomeFileRow
              item={makeItem()}
              client={client}
              selecting={false}
              selected={false}
              onOpen={() => {}}
              onToggleSelect={() => {}}
              onStartSelect={() => {}}
              onOpenMenu={() => {}}
            />
          </ul>
        </MobileLocaleProvider>,
      )
    })

    await flushMicrotasks()
    const thumb = container.querySelector('[data-testid="home-file-thumb-recent:r1"]')
    expect(thumb?.getAttribute('data-thumb-kind')).toBe('image')
    const img = container.querySelector<HTMLImageElement>('.home-act-thumb-img')
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(container.querySelector('.home-act-thumb-badge')?.textContent).toBe('HWPX')
  })

  it('renders a paper text card when backend returns a text snippet payload', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    containers.push(container)
    const client = mockThumbClient({
      kind: 'text',
      title: 'Meeting Notes',
      snippet: 'Agenda items for next sprint.',
    })

    act(() => {
      createRoot(container).render(
        <MobileLocaleProvider lang="ko">
          <ul className="mobile-doc-list" data-view="grid">
            <HomeFileRow
              item={makeItem({ key: 'recent:md1', name: 'notes.md', format: 'md' })}
              client={client}
              selecting={false}
              selected={false}
              onOpen={() => {}}
              onToggleSelect={() => {}}
              onStartSelect={() => {}}
              onOpenMenu={() => {}}
            />
          </ul>
        </MobileLocaleProvider>,
      )
    })

    await flushMicrotasks()
    const thumb = container.querySelector('[data-testid="home-file-thumb-recent:md1"]')
    expect(thumb?.getAttribute('data-thumb-kind')).toBe('text')
    expect(container.querySelector('.home-act-thumb-title')?.textContent).toBe('Meeting Notes')
    expect(container.querySelector('.home-act-thumb-snippet')?.textContent).toBe(
      'Agenda items for next sprint.',
    )
  })
})
