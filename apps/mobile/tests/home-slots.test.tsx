import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  MobileClient,
  MobileDocFormat,
  MobileDocSession,
} from '@genoffice/mobile-bridge/transport'
import { DocTypeIcon } from '../src/renderer/components/MobileIcons'
import { TRACK_DOC_TYPE_ICONS } from '../src/renderer/components/icons'
import type { HomeHost } from '../src/renderer/home/homeHost'
import { HOME_TABS, HOME_TABS_ENABLED } from '../src/renderer/home/homeTabs'
import { takeIncomingDocument } from '../src/renderer/home/incoming'
import { DEFAULT_PREFS } from '../src/renderer/settings/defaultPrefs'

const containers: HTMLElement[] = []

afterEach(() => {
  while (containers.length > 0) containers.pop()?.remove()
})

function render(node: React.ReactNode): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  containers.push(container)
  act(() => {
    createRoot(container).render(node)
  })
  return container
}

describe('home and icon slots for the tracks', () => {
  it('lists the four home tabs in order and keeps them off', () => {
    expect(HOME_TABS.map((tab) => tab.id)).toEqual(['recent', 'folders', 'tools', 'settings'])
    expect(HOME_TABS_ENABLED).toBe(false)
  })

  it('draws nothing for the empty folders and tools tabs', () => {
    const host = {} as HomeHost
    for (const tab of HOME_TABS) {
      if (!tab.Component) continue
      const Tab = tab.Component
      expect(render(<Tab host={host} />).innerHTML).toBe('')
    }
  })

  it('passes the incoming document through from the backend', async () => {
    const session = { sessionId: 's', format: 'md' } as unknown as MobileDocSession
    const client = { consumePendingOpenIntent: async () => session } as unknown as MobileClient
    await expect(takeIncomingDocument(client)).resolves.toBe(session)
  })

  it('starts with AI off', () => {
    expect(DEFAULT_PREFS.aiEnabled).toBe(false)
  })

  it('keeps the HWP, Markdown and text pictures, and falls back to the Markdown picture', () => {
    // tracks add pictures only for their own formats
    for (const format of ['hwp', 'hwpx', 'md', 'txt'] as const) {
      expect(TRACK_DOC_TYPE_ICONS[format]).toBeUndefined()
    }
    const src = (format: MobileDocFormat) =>
      render(<DocTypeIcon format={format} />)
        .querySelector('img')
        ?.getAttribute('src')
    const md = src('md')
    expect(md).toBeTruthy()
    expect(src('hwp')).not.toBe(md)
    // a format with no picture of its own shows the Markdown picture, as before
    const withoutPicture = (
      ['pdf', 'html', 'xlsx', 'xlsm', 'xls', 'csv', 'epub', 'pptx'] as const
    ).find((format) => !TRACK_DOC_TYPE_ICONS[format])
    if (withoutPicture) expect(src(withoutPicture)).toBe(md)
  })
})
