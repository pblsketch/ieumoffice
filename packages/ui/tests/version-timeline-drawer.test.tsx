// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { VersionTimelineDrawer } from '../src/VersionTimelineDrawer'
import { versionTimelineText } from '../src/strings-version-timeline'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('VersionTimelineDrawer', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('shows encrypted notice, copies prompt, saves checkpoint, and triggers restore/delete', () => {
    const onSaveCheckpoint = vi.fn()
    const onRestore = vi.fn()
    const onDelete = vi.fn()
    const onCopyPrompt = vi.fn()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    const entries = [
      {
        id: 'v1',
        source: 'ai' as const,
        createdAt: '2026-11-23T12:00:00.000Z',
        promptSummary: 'Make hero cleaner',
      },
    ]

    act(() => {
      root.render(
        <VersionTimelineDrawer
          open={true}
          lang="ko"
          entries={entries}
          encryptedMemoryOnly={true}
          onSaveCheckpoint={onSaveCheckpoint}
          onRestore={onRestore}
          onDelete={onDelete}
          onCopyPrompt={onCopyPrompt}
        />,
      )
    })

    expect(host.querySelector('[data-testid="vt-encrypted-notice"]')).not.toBeNull()
    const buttons = [...host.querySelectorAll('button')]
    act(() => {
      buttons.find((b) => b.textContent === versionTimelineText('ko', 'saveCheckpoint'))?.click()
      buttons.find((b) => b.textContent === versionTimelineText('ko', 'copyPrompt'))?.click()
      buttons.find((b) => b.textContent === versionTimelineText('ko', 'restoreVersion'))?.click()
      buttons.find((b) => b.textContent === versionTimelineText('ko', 'deleteVersion'))?.click()
    })

    expect(onSaveCheckpoint).toHaveBeenCalledTimes(1)
    expect(onCopyPrompt).toHaveBeenCalledWith('Make hero cleaner')
    expect(onRestore).toHaveBeenCalledWith(entries[0])
    expect(onDelete).toHaveBeenCalledWith(entries[0])

    act(() => {
      root.unmount()
    })
  })

  it('has native translations for all 22 languages', () => {
    const en = versionTimelineText('en', 'title')
    for (const lang of LANGS) {
      const text = versionTimelineText(lang, 'title')
      expect(text, lang).toBeTruthy()
      if (lang !== 'en') expect(text, lang).not.toBe(en)
    }
  })
})
