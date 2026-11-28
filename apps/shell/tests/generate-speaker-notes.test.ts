import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import type { GenerateHandoff } from '../src/shared/generate-api'
import { GenerateSession } from '../src/main/generate/session'

function createSession(kind: 'slides' | 'html' = 'slides') {
  const handoffs: GenerateHandoff[] = []
  const samplePath = join(tmpdir(), 'gen-speaker-notes', 'source.md')
  const session = new GenerateSession(
    {
      lang: () => 'ko',
      inspect: async (path) => ({
        key: path,
        path,
        name: 'source.md',
        ext: 'md',
        sizeBytes: 1200,
        textLength: 400,
        unsaved: false,
      }),
      pathOfUntitled: async () => null,
      saveActionFor: async () => 'save',
      saveMaterial: async () => 'saved',
      showUntitled: async () => {},
      openTargetTab: (handoff) => handoffs.push(handoff),
      push: vi.fn(),
      close: vi.fn(),
      newId: () => 'handoff-1',
      now: () => 1700000000000,
      recheckDelayMs: 0,
    },
    { refs: [{ path: samplePath }], kind },
  )
  return { session, handoffs }
}

describe('GenerateSession speaker-notes separation toggle', () => {
  it('defaults to OFF and omits speakerNotesSeparate when untouched', async () => {
    const { session, handoffs } = createSession('slides')
    await session.refresh()
    expect(session.state().speakerNotesSeparate).toBe(false)
    expect(await session.make('Create deck')).toBe(true)
    expect(handoffs).toHaveLength(1)
    expect(handoffs[0]!.speakerNotesSeparate).toBeUndefined()
  })

  it('passes speakerNotesSeparate: true only when enabled for slides target', async () => {
    const { session, handoffs } = createSession('slides')
    await session.refresh()
    session.setSpeakerNotesSeparate(true)
    expect(session.state().speakerNotesSeparate).toBe(true)
    expect(await session.make('Create deck')).toBe(true)
    expect(handoffs[0]!.speakerNotesSeparate).toBe(true)

    const { session: htmlSession, handoffs: htmlHandoffs } = createSession('html')
    await htmlSession.refresh()
    htmlSession.setSpeakerNotesSeparate(true)
    expect(await htmlSession.make('Create page')).toBe(true)
    expect(htmlHandoffs[0]!.speakerNotesSeparate).toBeUndefined()
  })
})
