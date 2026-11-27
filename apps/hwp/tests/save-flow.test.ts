import { describe, expect, it, vi } from 'vitest'
import {
  checkStalenessBeforeAction,
  runSave,
  runSubmissionSave,
  type SaveEditorPort,
  type SubmissionSaveEditorPort,
} from '../src/renderer/save-flow'
import { checkStalenessBeforePrint, runWithPrintStalenessCheck } from '../src/renderer/print-flow'
import type {
  BeginSaveResult,
  BeginSubmissionSaveResult,
  CommitSaveResult,
  CommitSubmissionSaveResult,
  MemoSnapshot,
  TabSpot,
} from '../src/shared/ipc'

const HWP = Uint8Array.from([1, 2, 3])
const HWPX = Uint8Array.from([4, 5, 6])
const PREVIEW = { text: '본문\r\n', image: Uint8Array.from([7, 8]) }

function editor(overrides: Partial<SaveEditorPort> = {}): SaveEditorPort {
  return {
    isPasswordProtected: vi.fn(async () => false),
    exportHwp: vi.fn(async () => HWP),
    exportHwpx: vi.fn(async () => HWPX),
    exportHwpVerify: vi.fn(async () => ({
      pageCountBefore: 3,
      pageCountAfter: 3,
      recovered: true,
    })),
    listMemos: vi.fn(async () => []),
    setMemoLock: vi.fn(async () => ({ ok: true })),
    measureTabs: vi.fn(async (spots: TabSpot[]) =>
      spots.map((spot) => (spot.tab === 0 ? { width: 4000, type: 0, fill: 0 } : null)),
    ),
    savePreview: vi.fn(async () => PREVIEW),
    notifySaved: vi.fn(async () => ({ ok: true })),
    ...overrides,
  }
}

function api(
  begin: BeginSaveResult,
  commit: CommitSaveResult = { ok: true, path: 'C:/d/a.hwp' },
  tabs: TabSpot[] = [],
) {
  return {
    beginSave: vi.fn(async () => begin),
    newTabs: vi.fn(async () => tabs),
    commitSave: vi.fn(async () => commit),
    abortSave: vi.fn(),
  }
}

const SPOTS: TabSpot[] = [
  { sec: 0, para: 1, cells: [], tab: 0, tabs: 2 },
  { sec: 0, para: 1, cells: [], tab: 1, tabs: 2 },
]

const MEMOS: MemoSnapshot[] = [
  {
    author: '이음',
    date: null,
    text: '확인 부탁드립니다.',
    place: 'body',
    sectionIndex: 0,
    paraIndex: 2,
    startCharIdx: 4,
    endCharIdx: 12,
    path: null,
  },
]

describe('runSave', () => {
  it('Save As with PDF picked exports nothing and commits nothing: the caller writes the PDF', async () => {
    const ed = editor()
    const host = api({ ok: true, path: 'C:/d/copy.pdf', export: 'pdf' })
    const outcome = await runSave(ed, host, 'saveAs')
    expect(outcome).toEqual({ kind: 'export', format: 'pdf', path: 'C:/d/copy.pdf' })
    expect(host.beginSave).toHaveBeenCalledWith('saveAs')
    expect(ed.exportHwp).not.toHaveBeenCalled()
    expect(ed.exportHwpx).not.toHaveBeenCalled()
    expect(host.commitSave).not.toHaveBeenCalled()
    expect(host.abortSave).not.toHaveBeenCalled()
    expect(ed.notifySaved).not.toHaveBeenCalled()
  })

  it('hands the main process the widths the editor measured for the tabs it found', async () => {
    const ed = editor()
    const host = api({ ok: true, path: 'C:/d/a.hwpx', format: 'hwpx' }, undefined, SPOTS)
    await runSave(ed, host, 'save')
    expect(host.newTabs).toHaveBeenCalledWith(HWPX, 'hwpx')
    expect(ed.measureTabs).toHaveBeenCalledWith(SPOTS)
    // a tab the editor could not measure is left out
    expect(host.commitSave).toHaveBeenCalledWith(
      HWPX,
      [{ ...SPOTS[0], width: 4000, type: 0, fill: 0 }],
      { auto: false, memos: [], preview: PREVIEW },
    )
  })

  it('marks an automatic save so a copy-pair conflict stands down quietly', async () => {
    const ed = editor()
    const host = api({ ok: true, path: 'C:/d/a.hwp', format: 'hwp' })
    await runSave(ed, host, 'save', true)
    expect(host.commitSave).toHaveBeenCalledWith(HWP, [], { auto: true, preview: PREVIEW })
  })

  it('treats the copy-pair deferral as a cancel, not a failure', async () => {
    // the main process refuses the write while a sibling copy holds the disk
    // version (a deferred autosave or a declined overwrite): the renderer must
    // stay silent instead of showing a save failure with an internal string
    const ed = editor()
    const host = api(
      { ok: true, path: 'C:/d/a.hwp', format: 'hwp' },
      {
        ok: false,
        error: 'hwp: external-modified',
      },
    )
    await expect(runSave(ed, host, 'save')).resolves.toEqual({ kind: 'canceled' })
    expect(ed.notifySaved).not.toHaveBeenCalled()
  })

  it('saves without widths when measuring fails', async () => {
    const ed = editor({
      measureTabs: vi.fn(async () => {
        throw new Error('the editor is not ready')
      }),
    })
    const host = api({ ok: true, path: 'C:/d/a.hwp', format: 'hwp' }, undefined, SPOTS)
    const outcome = await runSave(ed, host, 'save')
    expect(outcome).toEqual({ kind: 'saved', path: 'C:/d/a.hwp' })
    expect(host.commitSave).toHaveBeenCalledWith(HWP, [], { auto: false, preview: PREVIEW })
  })

  it('sends a null preview when the editor cannot make one, and still saves', async () => {
    // null makes the main process write a blank preview, never the opened file's (decision 0146)
    const ed = editor({
      savePreview: vi.fn(async () => {
        throw new Error('the editor is not ready')
      }),
    })
    const host = api({ ok: true, path: 'C:/d/a.hwp', format: 'hwp' })
    const outcome = await runSave(ed, host, 'save')
    expect(outcome).toEqual({ kind: 'saved', path: 'C:/d/a.hwp' })
    expect(host.commitSave).toHaveBeenCalledWith(HWP, [], { auto: false, preview: null })
  })

  it('does not ask the editor when no tab lacks a width', async () => {
    const ed = editor()
    const host = api({ ok: true, path: 'C:/d/a.hwp', format: 'hwp' })
    await runSave(ed, host, 'save')
    expect(ed.measureTabs).not.toHaveBeenCalled()
  })

  it('writes nothing for a document with tracked changes, and says why', async () => {
    const ed = editor()
    const host = api({
      ok: false,
      error: 'hwp: the document has tracked changes',
      reason: 'tracked',
    })
    const outcome = await runSave(ed, host, 'saveAs')
    expect(outcome).toEqual({ kind: 'failed', reason: 'tracked' })
    expect(ed.exportHwp).not.toHaveBeenCalled()
    expect(ed.exportHwpx).not.toHaveBeenCalled()
    expect(host.commitSave).not.toHaveBeenCalled()
  })

  it('reports a save that could not carry master pages or memos over', async () => {
    const ed = editor()
    const host = api(
      { ok: true, path: 'C:/d/a.hwp', format: 'hwp' },
      { ok: true, path: 'C:/d/a.hwp', backupPath: 'C:/d/a.hwp.bak', tailsLost: true },
    )
    const outcome = await runSave(ed, host, 'save')
    expect(outcome).toEqual({
      kind: 'saved',
      path: 'C:/d/a.hwp',
      backupPath: 'C:/d/a.hwp.bak',
      tailsLost: true,
    })
    // the file is written: the editor is told so
    expect(ed.notifySaved).toHaveBeenCalledWith('a.hwp')
  })

  it('writes HWP bytes only after the engine read its own output back whole', async () => {
    const ed = editor()
    const host = api({ ok: true, path: 'C:/d/a.hwp', format: 'hwp' })
    const outcome = await runSave(ed, host, 'save')
    expect(outcome).toEqual({ kind: 'saved', path: 'C:/d/a.hwp' })
    expect(ed.exportHwpVerify).toHaveBeenCalledOnce()
    expect(host.commitSave).toHaveBeenCalledWith(HWP, [], { auto: false, preview: PREVIEW })
    expect(ed.notifySaved).toHaveBeenCalledWith('a.hwp')
    expect(host.abortSave).not.toHaveBeenCalled()
  })

  it('exports HWPX for an hwpx target and reports the backup the write kept', async () => {
    const ed = editor()
    const host = api(
      { ok: true, path: 'C:\\d\\a.hwpx', format: 'hwpx' },
      { ok: true, path: 'C:\\d\\a.hwpx', backupPath: 'C:\\d\\a.hwpx.bak' },
    )
    const outcome = await runSave(ed, host, 'save')
    expect(outcome).toEqual({
      kind: 'saved',
      path: 'C:\\d\\a.hwpx',
      backupPath: 'C:\\d\\a.hwpx.bak',
    })
    expect(ed.exportHwpx).toHaveBeenCalledOnce()
    expect(ed.exportHwp).not.toHaveBeenCalled()
    expect(ed.exportHwpVerify).not.toHaveBeenCalled()
    expect(ed.notifySaved).toHaveBeenCalledWith('a.hwpx')
  })

  it('does not ask for memos when saving HWP', async () => {
    const ed = editor()
    const host = api({ ok: true, path: 'C:/d/a.hwp', format: 'hwp' })
    await runSave(ed, host, 'save')
    expect(ed.setMemoLock).not.toHaveBeenCalled()
    expect(ed.listMemos).not.toHaveBeenCalled()
    expect(host.commitSave).toHaveBeenCalledWith(HWP, [], { auto: false, preview: PREVIEW })
  })

  it('lists HWPX memos under the lock and releases it before measuring tabs', async () => {
    const ed = editor({ listMemos: vi.fn(async () => MEMOS) })
    const host = api({ ok: true, path: 'C:/d/a.hwpx', format: 'hwpx' })
    await runSave(ed, host, 'save')
    expect(ed.setMemoLock).toHaveBeenNthCalledWith(1, true)
    expect(ed.setMemoLock).toHaveBeenNthCalledWith(2, false)
    expect(ed.listMemos).toHaveBeenCalledOnce()
    expect(host.commitSave).toHaveBeenCalledWith(HWPX, [], {
      auto: false,
      memos: MEMOS,
      preview: PREVIEW,
    })
    // the document is unlocked before the host works on the bytes
    const lock = vi.mocked(ed.setMemoLock)
    expect(lock.mock.invocationCallOrder[1]).toBeLessThan(host.newTabs.mock.invocationCallOrder[0])
  })

  it('saves HWPX without a trusted memo list when the lock cannot be taken', async () => {
    const ed = editor({
      setMemoLock: vi.fn(async () => {
        throw new Error('the editor is not ready')
      }),
    })
    const host = api(
      { ok: true, path: 'C:/d/a.hwpx', format: 'hwpx' },
      { ok: true, path: 'C:/d/a.hwpx' },
    )
    expect(await runSave(ed, host, 'save')).toEqual({ kind: 'saved', path: 'C:/d/a.hwpx' })
    expect(ed.listMemos).not.toHaveBeenCalled()
    expect(ed.exportHwpx).toHaveBeenCalledOnce()
    expect(host.commitSave).toHaveBeenCalledWith(HWPX, [], {
      auto: false,
      memos: null,
      preview: PREVIEW,
    })
  })

  it('saves HWPX without a memo list when the editor cannot list them', async () => {
    const ed = editor({
      listMemos: vi.fn(async () => {
        throw new Error('this build has no memo API')
      }),
    })
    const host = api(
      { ok: true, path: 'C:/d/a.hwpx', format: 'hwpx' },
      { ok: true, path: 'C:/d/a.hwpx' },
    )
    expect(await runSave(ed, host, 'save')).toEqual({ kind: 'saved', path: 'C:/d/a.hwpx' })
    expect(ed.setMemoLock).toHaveBeenNthCalledWith(2, false)
    expect(host.commitSave).toHaveBeenCalledWith(HWPX, [], {
      auto: false,
      memos: null,
      preview: PREVIEW,
    })
  })

  it('releases the memo lock when the HWPX export throws', async () => {
    const ed = editor({
      exportHwpx: vi.fn(async () => {
        throw new Error('serializer failed')
      }),
    })
    const host = api({ ok: true, path: 'C:/d/a.hwpx', format: 'hwpx' })
    expect(await runSave(ed, host, 'save')).toEqual({
      kind: 'failed',
      reason: 'export',
      detail: 'serializer failed',
    })
    expect(ed.setMemoLock).toHaveBeenNthCalledWith(1, true)
    expect(ed.setMemoLock).toHaveBeenNthCalledWith(2, false)
    expect(host.abortSave).toHaveBeenCalledOnce()
    expect(host.commitSave).not.toHaveBeenCalled()
  })

  it('still saves when the lock will not be released', async () => {
    const ed = editor({
      setMemoLock: vi
        .fn()
        .mockResolvedValueOnce({ ok: true })
        .mockRejectedValueOnce(new Error('bridge closed')),
    })
    const host = api(
      { ok: true, path: 'C:/d/a.hwpx', format: 'hwpx' },
      { ok: true, path: 'C:/d/a.hwpx' },
    )
    expect(await runSave(ed, host, 'save')).toEqual({ kind: 'saved', path: 'C:/d/a.hwpx' })
    expect(host.commitSave).toHaveBeenCalledOnce()
  })

  it('stops quietly when the main process refuses because a memo editor is open', async () => {
    const ed = editor()
    const host = api({
      ok: false,
      error: 'hwp: a memo editor is open',
      reason: 'memo',
    })
    expect(await runSave(ed, host, 'save')).toEqual({ kind: 'canceled' })
    expect(ed.exportHwpx).not.toHaveBeenCalled()
    expect(ed.exportHwp).not.toHaveBeenCalled()
    expect(host.commitSave).not.toHaveBeenCalled()
  })

  it('reports the HWPX memos the written file lacks', async () => {
    const host = api(
      { ok: true, path: 'C:/d/a.hwpx', format: 'hwpx' },
      { ok: true, path: 'C:/d/a.hwpx', memosLost: 2 },
    )
    expect(await runSave(editor(), host, 'save')).toEqual({
      kind: 'saved',
      path: 'C:/d/a.hwpx',
      memosLost: 2,
    })
  })

  it('writes nothing when the HWP read-back loses pages, and reports before/after counts', async () => {
    const ed = editor({
      exportHwpVerify: vi.fn(async () => ({
        pageCountBefore: 11,
        pageCountAfter: 7,
        recovered: false,
      })),
    })
    const host = api({ ok: true, path: 'C:/d/a.hwp', format: 'hwp' })
    expect(await runSave(ed, host, 'save')).toEqual({
      kind: 'failed',
      reason: 'verify',
      verify: { pageCountBefore: 11, pageCountAfter: 7, recovered: false },
    })
    expect(host.commitSave).not.toHaveBeenCalled()
    expect(host.abortSave).toHaveBeenCalledOnce()
    expect(ed.notifySaved).not.toHaveBeenCalled()
  })

  it('writes nothing when the engine could not reload its output at all', async () => {
    const ed = editor({
      exportHwpVerify: vi.fn(async () => ({
        pageCountBefore: 9,
        pageCountAfter: 9,
        recovered: false,
      })),
    })
    const host = api({ ok: true, path: 'C:/d/a.hwp', format: 'hwp' })
    expect(await runSave(ed, host, 'save')).toEqual({
      kind: 'failed',
      reason: 'verify',
      verify: { pageCountBefore: 9, pageCountAfter: 9, recovered: false },
    })
    expect(host.commitSave).not.toHaveBeenCalled()
  })

  it('passes saveAsHwpx through to beginSave and writes HWPX without HWP read-back check', async () => {
    const ed = editor()
    const host = api(
      { ok: true, path: '/tmp/report.hwpx', format: 'hwpx' },
      { ok: true, path: '/tmp/report.hwpx' },
    )
    expect(await runSave(ed, host, 'saveAsHwpx')).toEqual({
      kind: 'saved',
      path: '/tmp/report.hwpx',
    })
    expect(host.beginSave).toHaveBeenCalledWith('saveAsHwpx')
    expect(ed.exportHwpVerify).not.toHaveBeenCalled()
    expect(ed.exportHwpx).toHaveBeenCalledOnce()
    expect(ed.notifySaved).toHaveBeenCalledWith('report.hwpx')
  })

  it('releases the pending save when the export throws', async () => {
    const ed = editor({
      exportHwpx: vi.fn(async () => {
        throw new Error('serializer failed')
      }),
    })
    const host = api({ ok: true, path: 'C:/d/a.hwpx', format: 'hwpx' })
    expect(await runSave(ed, host, 'save')).toEqual({
      kind: 'failed',
      reason: 'export',
      detail: 'serializer failed',
    })
    expect(host.abortSave).toHaveBeenCalledOnce()
    expect(host.commitSave).not.toHaveBeenCalled()
  })

  it('never writes a password-protected document, under its own name or a new one', async () => {
    for (const mode of ['save', 'saveAs'] as const) {
      const ed = editor({ isPasswordProtected: vi.fn(async () => true) })
      const host = api({ ok: true, path: 'C:/d/a.hwpx', format: 'hwpx' })
      expect(await runSave(ed, host, mode)).toEqual({ kind: 'failed', reason: 'protected' })
      // no dialog, no export, no write; the waiting main process is released
      expect(host.beginSave).not.toHaveBeenCalled()
      expect(ed.exportHwpx).not.toHaveBeenCalled()
      expect(host.commitSave).not.toHaveBeenCalled()
      expect(host.abortSave).toHaveBeenCalledOnce()
    }
  })

  it('does not write when the editor cannot say whether the document is protected', async () => {
    const ed = editor({
      isPasswordProtected: vi.fn(async () => {
        throw new Error('the editor did not report password protection')
      }),
    })
    const host = api({ ok: true, path: 'C:/d/a.hwp', format: 'hwp' })
    expect(await runSave(ed, host, 'save')).toEqual({
      kind: 'failed',
      reason: 'export',
      detail: 'the editor did not report password protection',
    })
    expect(host.beginSave).not.toHaveBeenCalled()
    expect(host.commitSave).not.toHaveBeenCalled()
    expect(host.abortSave).toHaveBeenCalledOnce()
  })

  it('stops quietly when the Save As dialog is canceled', async () => {
    const ed = editor()
    const host = api({ ok: true, canceled: true })
    expect(await runSave(ed, host, 'saveAs')).toEqual({ kind: 'canceled' })
    expect(ed.exportHwp).not.toHaveBeenCalled()
    expect(ed.exportHwpx).not.toHaveBeenCalled()
    expect(host.commitSave).not.toHaveBeenCalled()
  })

  it('keeps the editor dirty when the write fails', async () => {
    const ed = editor()
    const host = api(
      { ok: true, path: 'C:/d/a.hwp', format: 'hwp' },
      { ok: false, error: 'EACCES: permission denied' },
    )
    expect(await runSave(ed, host, 'save')).toEqual({
      kind: 'failed',
      reason: 'write',
      detail: 'EACCES: permission denied',
    })
    expect(ed.notifySaved).not.toHaveBeenCalled()
  })

  it('still counts as saved when the editor cannot be told', async () => {
    const ed = editor({
      notifySaved: vi.fn(async () => {
        throw new Error('bridge closed')
      }),
    })
    const host = api({ ok: true, path: 'C:/d/a.hwp', format: 'hwp' })
    expect(await runSave(ed, host, 'save')).toEqual({ kind: 'saved', path: 'C:/d/a.hwp' })
  })

  it('never invokes onStaleCheck during automatic save', async () => {
    const ed = editor()
    const host = api({ ok: true, path: 'C:/d/a.hwp', format: 'hwp' })
    const onStaleCheck = vi.fn(async () => 'cancel' as const)
    const outcome = await runSave(ed, host, 'save', true, { onStaleCheck })
    expect(outcome).toEqual({ kind: 'saved', path: 'C:/d/a.hwp' })
    expect(onStaleCheck).not.toHaveBeenCalled()
  })

  it('invokes onStaleCheck during manual save and cancels cleanly before opening dialogs', async () => {
    const ed = editor()
    const host = api({ ok: true, path: 'C:/d/a.hwp', format: 'hwp' })
    const onStaleCheck = vi.fn(async () => 'cancel' as const)
    const outcome = await runSave(ed, host, 'saveAs', false, { onStaleCheck })
    expect(outcome).toEqual({ kind: 'canceled' })
    expect(onStaleCheck).toHaveBeenCalledOnce()
    expect(host.beginSave).not.toHaveBeenCalled()
    expect(host.commitSave).not.toHaveBeenCalled()
    expect(host.abortSave).toHaveBeenCalledOnce()
  })

  it('fails open when onStaleCheck throws on manual save', async () => {
    const ed = editor()
    const host = api({ ok: true, path: 'C:/d/a.hwp', format: 'hwp' })
    const onStaleCheck = vi.fn(async () => {
      throw new Error('staleness check crashed')
    })
    const outcome = await runSave(ed, host, 'save', false, { onStaleCheck })
    expect(outcome).toEqual({ kind: 'saved', path: 'C:/d/a.hwp' })
    expect(onStaleCheck).toHaveBeenCalledOnce()
    expect(host.commitSave).toHaveBeenCalledOnce()
  })
})

describe('staleness pre-action gate', () => {
  it('skips prompt when nothing is stale and fails open when checkStale throws', async () => {
    const promptUser = vi.fn(async () => 'cancel' as const)
    expect(
      await checkStalenessBeforeAction('save', async () => ({ stale: false, items: [] }), promptUser),
    ).toBe('continue')
    expect(promptUser).not.toHaveBeenCalled()

    expect(
      await checkStalenessBeforeAction(
        'save',
        async () => {
          throw new Error('engine error')
        },
        promptUser,
      ),
    ).toBe('continue')
    expect(promptUser).not.toHaveBeenCalled()
  })

  it('runs refreshAll before continuing when the user chooses refresh', async () => {
    const refreshAll = vi.fn(async () => ({ ok: true, refreshed: 2 }))
    const promptUser = vi.fn(async () => 'refresh' as const)
    const report = {
      stale: true,
      items: [{ id: 'toc:body', kind: 'body', reason: 'pages_changed' }],
    }
    const verdict = await checkStalenessBeforeAction('pdf', async () => report, promptUser, {
      refreshAll,
    })
    expect(verdict).toBe('continue')
    expect(promptUser).toHaveBeenCalledWith(report, 'pdf')
    expect(refreshAll).toHaveBeenCalledOnce()
  })

  it('supports print and PDF staleness checks with fail-open behavior', async () => {
    const promptUser = vi.fn(async () => 'cancel' as const)
    const report = {
      stale: true,
      items: [{ id: 'index', kind: 'index', reason: 'entries_changed' }],
    }
    expect(await checkStalenessBeforePrint('print', async () => report, promptUser)).toBe('cancel')
    expect(promptUser).toHaveBeenCalledWith(report, 'print')

    const run = vi.fn(async () => 'printed')
    expect(
      await runWithPrintStalenessCheck(async () => 'cancel', run),
    ).toEqual({ canceled: true })
    expect(run).not.toHaveBeenCalled()

    expect(
      await runWithPrintStalenessCheck(async () => {
        throw new Error('check failed')
      }, run),
    ).toEqual({ canceled: false, value: 'printed' })
    expect(run).toHaveBeenCalledOnce()
  })
})

function submissionEditor(
  overrides: Partial<SubmissionSaveEditorPort> = {},
): SubmissionSaveEditorPort & { notifySaved: ReturnType<typeof vi.fn> } {
  return {
    isPasswordProtected: vi.fn(async () => false),
    exportSubmissionCopy: vi.fn(async (format) => ({
      bytes: format === 'hwp' ? HWP : HWPX,
      ...(format === 'hwp'
        ? { verify: { pageCountBefore: 3, pageCountAfter: 3, recovered: true } }
        : {}),
    })),
    measureTabs: vi.fn(async (spots: TabSpot[]) =>
      spots.map((spot) => (spot.tab === 0 ? { width: 4000, type: 0, fill: 0 } : null)),
    ),
    savePreview: vi.fn(async () => PREVIEW),
    notifySaved: vi.fn(async () => ({ ok: true })),
    ...overrides,
  }
}

function submissionApi(
  begin: BeginSubmissionSaveResult,
  commit: CommitSubmissionSaveResult = { ok: true, path: 'C:/d/a_submission.hwpx' },
  tabs: TabSpot[] = [],
) {
  return {
    beginSubmissionSave: vi.fn(async () => begin),
    newTabs: vi.fn(async () => tabs),
    commitSubmissionSave: vi.fn(async () => commit),
    abortSubmissionSave: vi.fn(),
  }
}

describe('runSubmissionSave', () => {
  it('writes the stripped submission copy without calling notifySaved', async () => {
    const ed = submissionEditor()
    const host = submissionApi(
      { ok: true, path: 'C:/d/a_submission.hwpx', format: 'hwpx' },
      { ok: true, path: 'C:/d/a_submission.hwpx' },
      SPOTS,
    )
    const onStaleCheck = vi.fn(async () => 'continue' as const)
    const outcome = await runSubmissionSave(ed, host, { onStaleCheck })
    expect(outcome).toEqual({ kind: 'saved', path: 'C:/d/a_submission.hwpx' })
    expect(onStaleCheck).toHaveBeenCalledOnce()
    expect(ed.exportSubmissionCopy).toHaveBeenCalledWith('hwpx')
    expect(host.newTabs).toHaveBeenCalledWith(HWPX, 'hwpx')
    expect(host.commitSubmissionSave).toHaveBeenCalledWith(
      HWPX,
      [{ ...SPOTS[0], width: 4000, type: 0, fill: 0 }],
      { preview: PREVIEW },
    )
    // Original tab's dirty flag and file path must never be modified.
    expect(ed.notifySaved).not.toHaveBeenCalled()
    expect(host.abortSubmissionSave).not.toHaveBeenCalled()
  })

  it('refuses password-protected documents before staleness check or dialog', async () => {
    const ed = submissionEditor({ isPasswordProtected: vi.fn(async () => true) })
    const host = submissionApi({ ok: true, path: 'C:/d/a_sub.hwpx', format: 'hwpx' })
    const onStaleCheck = vi.fn(async () => 'continue' as const)
    expect(await runSubmissionSave(ed, host, { onStaleCheck })).toEqual({
      kind: 'failed',
      reason: 'protected',
    })
    expect(onStaleCheck).not.toHaveBeenCalled()
    expect(host.beginSubmissionSave).not.toHaveBeenCalled()
    expect(host.commitSubmissionSave).not.toHaveBeenCalled()
    expect(host.abortSubmissionSave).toHaveBeenCalledOnce()
  })

  it('cancels before opening the file dialog when staleness check cancels', async () => {
    const ed = submissionEditor()
    const host = submissionApi({ ok: true, path: 'C:/d/a_sub.hwpx', format: 'hwpx' })
    const outcome = await runSubmissionSave(ed, host, {
      onStaleCheck: async () => 'cancel',
    })
    expect(outcome).toEqual({ kind: 'canceled' })
    expect(host.beginSubmissionSave).not.toHaveBeenCalled()
    expect(ed.exportSubmissionCopy).not.toHaveBeenCalled()
    expect(host.commitSubmissionSave).not.toHaveBeenCalled()
    expect(host.abortSubmissionSave).toHaveBeenCalledOnce()
  })

  it('writes nothing when the document has tracked changes', async () => {
    const ed = submissionEditor()
    const host = submissionApi({
      ok: false,
      error: 'hwp: the document has tracked changes',
      reason: 'tracked',
    })
    expect(await runSubmissionSave(ed, host)).toEqual({ kind: 'failed', reason: 'tracked' })
    expect(ed.exportSubmissionCopy).not.toHaveBeenCalled()
    expect(host.commitSubmissionSave).not.toHaveBeenCalled()
  })

  it('stops quietly when a memo editor is open or the dialog is canceled', async () => {
    const ed = submissionEditor()
    const memoHost = submissionApi({
      ok: false,
      error: 'hwp: a memo editor is open',
      reason: 'memo',
    })
    expect(await runSubmissionSave(ed, memoHost)).toEqual({ kind: 'canceled' })
    expect(memoHost.commitSubmissionSave).not.toHaveBeenCalled()

    const cancelHost = submissionApi({ ok: true, canceled: true })
    expect(await runSubmissionSave(ed, cancelHost)).toEqual({ kind: 'canceled' })
    expect(ed.exportSubmissionCopy).not.toHaveBeenCalled()
    expect(cancelHost.commitSubmissionSave).not.toHaveBeenCalled()
  })

  it('aborts and writes nothing when HWP submission verification fails', async () => {
    const ed = submissionEditor({
      exportSubmissionCopy: vi.fn(async () => ({
        bytes: HWP,
        verify: { pageCountBefore: 5, pageCountAfter: 4, recovered: true },
      })),
    })
    const host = submissionApi({ ok: true, path: 'C:/d/a_sub.hwp', format: 'hwp' })
    expect(await runSubmissionSave(ed, host)).toEqual({
      kind: 'failed',
      reason: 'verify',
      verify: { pageCountBefore: 5, pageCountAfter: 4, recovered: true },
    })
    expect(host.abortSubmissionSave).toHaveBeenCalledOnce()
    expect(host.commitSubmissionSave).not.toHaveBeenCalled()
    expect(ed.notifySaved).not.toHaveBeenCalled()
  })

  it('aborts and writes nothing when building the submission copy throws', async () => {
    const ed = submissionEditor({
      exportSubmissionCopy: vi.fn(async () => {
        throw new Error('clone failed')
      }),
    })
    const host = submissionApi({ ok: true, path: 'C:/d/a_sub.hwpx', format: 'hwpx' })
    expect(await runSubmissionSave(ed, host)).toEqual({
      kind: 'failed',
      reason: 'export',
      detail: 'clone failed',
    })
    expect(host.abortSubmissionSave).toHaveBeenCalledOnce()
    expect(host.commitSubmissionSave).not.toHaveBeenCalled()
  })

  it('reports write failure cleanly without calling notifySaved', async () => {
    const ed = submissionEditor()
    const host = submissionApi(
      { ok: true, path: 'C:/d/a_sub.hwpx', format: 'hwpx' },
      { ok: false, error: 'ENOSPC: no space left on device' },
    )
    expect(await runSubmissionSave(ed, host)).toEqual({
      kind: 'failed',
      reason: 'write',
      detail: 'ENOSPC: no space left on device',
    })
    expect(ed.notifySaved).not.toHaveBeenCalled()
  })
})
