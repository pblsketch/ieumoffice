/**
 * Verifies IeumOffice's custom attachment/handoff grant producers and extra
 * editor attachment gates (follow-up to upstream #2758).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  queueGenerateHandoff,
  queueSkillHandoff,
  resetGenerateHandoffsForTest,
  takeGenerateHandoff,
  takeSkillHandoff,
} from '@genoffice/electron-utils/generate-handoff'
import { sharedPathGrants } from '@genoffice/electron-utils'

afterEach(() => {
  resetGenerateHandoffsForTest()
  sharedPathGrants().release(101)
  sharedPathGrants().release(102)
})

describe('handoff path grants', () => {
  it('grants generate handoff material paths only to the taking webContents', () => {
    const material = join('/tmp', 'ieum-material-1.docx')
    queueGenerateHandoff(101, {
      id: 'h-1',
      mode: 'ai',
      target: 'slides',
      materials: [{ path: material, name: 'ieum-material-1.docx' }],
      text: 'Summarize',
      defaultText: false,
      createdAt: Date.now(),
    })
    expect(sharedPathGrants().has(101, material)).toBe(false)
    const taken = takeGenerateHandoff('slides', 101)
    expect(taken?.id).toBe('h-1')
    expect(sharedPathGrants().has(101, material)).toBe(true)
    expect(sharedPathGrants().has(102, material)).toBe(false)
  })

  it('grants skill handoff attached document paths only to the taking webContents', () => {
    const attached = join('/tmp', 'ieum-current-doc.hwp')
    queueSkillHandoff(101, {
      id: 's-1',
      mode: 'skill',
      target: 'hwp',
      text: 'Apply template',
      chips: [],
      attach: [attached],
      createdAt: Date.now(),
    })
    expect(sharedPathGrants().has(101, attached)).toBe(false)
    const taken = takeSkillHandoff('hwp', 101)
    expect(taken?.id).toBe('s-1')
    expect(sharedPathGrants().has(101, attached)).toBe(true)
    expect(sharedPathGrants().has(102, attached)).toBe(false)
  })
})

describe('shell custom picker grant wiring', () => {
  const root = join(__dirname, '..', 'src', 'main')

  it('grants Drive, Doc Picker (@mention included), and Connector Picker paths', () => {
    const drive = readFileSync(join(root, 'drive', 'drive-ipc.ts'), 'utf8')
    expect(drive).toContain('sharedPathGrants().grant(event.sender.id, res.paths)')

    const docPicker = readFileSync(join(root, 'doc-picker', 'doc-picker-window.ts'), 'utf8')
    expect(docPicker).toContain('sharedPathGrants().grant(event.sender.id, res.paths)')
    expect(docPicker).toContain('sharedPathGrants().grant(id, paths)')

    const connectorPicker = readFileSync(join(root, 'connector-picker', 'picker-window.ts'), 'utf8')
    expect(connectorPicker).toContain('sharedPathGrants().grant(event.sender.id, res.paths)')
  })

  it('installs grant release, drop-seen ledger, and project-root reveal check in shell main', () => {
    const index = readFileSync(join(root, 'index.ts'), 'utf8')
    expect(index).toContain('installGrantRelease()')
    expect(index).toContain('USER_FILE_PATHS_SEEN_CHANNEL')
    expect(index).toContain('projectFolderRoots(APP_SETTINGS_PATH())')
    expect(index).toContain('!isBesideOpenDocument(path)')
  })
})
