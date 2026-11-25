import { describe, expect, it, vi } from 'vitest'
import {
  appInfo,
  clearStorage,
  countFolderEntries,
  deleteFiles,
  deleteGroup,
  duplicateFile,
  type FileRef,
  HOME_ERROR_KEYS,
  linkFolder,
  listFavorites,
  listFolder,
  listFolders,
  listGroups,
  moveToGroup,
  openExternalUrl,
  openFolderEntry,
  openIncomingEntry,
  openFavorite,
  openSample,
  readFileRefBytes,
  recentMeta,
  renameFile,
  saveGroup,
  setFavorite,
  setKeepScreenOn,
  shareFiles,
  storageUsage,
  takeIncoming,
  unlinkFolder,
} from '../src/home'
import {
  createMobileClient,
  MobileCommandError,
  type MobileClient,
  type MobileTransport,
} from '../src/transport'

type InvokeMock = ReturnType<typeof vi.fn>

function makeClient(answer: (command: string) => unknown = () => ({ ok: true })): {
  client: MobileClient
  invoke: InvokeMock
} {
  const invoke = vi.fn(async (command: string) => answer(command))
  const transport: MobileTransport = {
    invoke: invoke as unknown as MobileTransport['invoke'],
    listen: async () => () => {},
  }
  return { client: createMobileClient(transport), invoke }
}

const recentRef: FileRef = { kind: 'recent', id: 'r1' }
const folderRef: FileRef = { kind: 'folder', folderId: 'f1', entryId: 'e1' }

interface Case {
  readonly name: string
  readonly run: (client: MobileClient) => Promise<unknown>
  readonly command: string
  readonly args: Record<string, unknown> | undefined
}

const CASES: readonly Case[] = [
  {
    name: 'listFolders',
    run: (c) => listFolders(c),
    command: 'mobile_home_list_folders',
    args: undefined,
  },
  { name: 'linkFolder', run: (c) => linkFolder(c), command: 'mobile_home_link_folder', args: {} },
  {
    name: 'linkFolder with replaceId',
    run: (c) => linkFolder(c, 'f1'),
    command: 'mobile_home_link_folder',
    args: { replaceId: 'f1' },
  },
  {
    name: 'unlinkFolder',
    run: (c) => unlinkFolder(c, 'f1'),
    command: 'mobile_home_unlink_folder',
    args: { id: 'f1' },
  },
  {
    name: 'countFolderEntries',
    run: (c) => countFolderEntries(c, 'f1'),
    command: 'mobile_home_count_folder_entries',
    args: { id: 'f1' },
  },
  {
    name: 'listFolder',
    run: (c) => listFolder(c, 'f1', ['a', 'b']),
    command: 'mobile_home_list_folder',
    args: { folderId: 'f1', path: ['a', 'b'] },
  },
  {
    name: 'openFolderEntry',
    run: (c) => openFolderEntry(c, 'f1', 'e1'),
    command: 'mobile_home_open_folder_entry',
    args: { folderId: 'f1', entryId: 'e1' },
  },
  {
    name: 'listFavorites',
    run: (c) => listFavorites(c),
    command: 'mobile_home_list_favorites',
    args: undefined,
  },
  {
    name: 'setFavorite',
    run: (c) => setFavorite(c, recentRef, true),
    command: 'mobile_home_set_favorite',
    args: { fileRef: recentRef, on: true },
  },
  {
    name: 'listGroups',
    run: (c) => listGroups(c),
    command: 'mobile_home_list_groups',
    args: undefined,
  },
  {
    name: 'saveGroup (new)',
    run: (c) => saveGroup(c, { name: 'Work' }),
    command: 'mobile_home_save_group',
    args: { name: 'Work' },
  },
  {
    name: 'saveGroup (rename)',
    run: (c) => saveGroup(c, { id: 'g1', name: 'Work' }),
    command: 'mobile_home_save_group',
    args: { id: 'g1', name: 'Work' },
  },
  {
    name: 'deleteGroup',
    run: (c) => deleteGroup(c, 'g1'),
    command: 'mobile_home_delete_group',
    args: { id: 'g1' },
  },
  {
    name: 'moveToGroup',
    run: (c) => moveToGroup(c, [recentRef], 'g1'),
    command: 'mobile_home_move_to_group',
    args: { refs: [recentRef], groupId: 'g1' },
  },
  {
    name: 'moveToGroup (no group)',
    run: (c) => moveToGroup(c, [recentRef], null),
    command: 'mobile_home_move_to_group',
    args: { refs: [recentRef], groupId: null },
  },
  {
    name: 'renameFile',
    run: (c) => renameFile(c, folderRef, 'Report'),
    command: 'mobile_home_rename',
    args: { fileRef: folderRef, newBaseName: 'Report' },
  },
  {
    name: 'duplicateFile',
    run: (c) => duplicateFile(c, folderRef, 'copy'),
    command: 'mobile_home_duplicate',
    args: { fileRef: folderRef, copySuffix: 'copy' },
  },
  {
    name: 'deleteFiles',
    run: (c) => deleteFiles(c, [folderRef]),
    command: 'mobile_home_delete',
    args: { refs: [folderRef] },
  },
  {
    name: 'shareFiles',
    run: (c) => shareFiles(c, [recentRef, folderRef]),
    command: 'mobile_home_share_files',
    args: { refs: [recentRef, folderRef] },
  },
  {
    name: 'recentMeta',
    run: (c) => recentMeta(c),
    command: 'mobile_home_recent_meta',
    args: undefined,
  },
  {
    name: 'takeIncoming',
    run: (c) => takeIncoming(c),
    command: 'mobile_home_take_incoming',
    args: undefined,
  },
  {
    name: 'openIncomingEntry',
    run: (c) => openIncomingEntry(c, 'b1', 'e1'),
    command: 'mobile_home_open_incoming_entry',
    args: { batchId: 'b1', entryId: 'e1' },
  },
  {
    name: 'openFavorite',
    run: (c) => openFavorite(c, 'k1'),
    command: 'mobile_home_open_favorite',
    args: { docKey: 'k1' },
  },
  {
    name: 'openSample',
    run: (c) => openSample(c, 'ko'),
    command: 'mobile_home_open_sample',
    args: { lang: 'ko' },
  },
  {
    name: 'storageUsage',
    run: (c) => storageUsage(c),
    command: 'mobile_home_storage_usage',
    args: undefined,
  },
  {
    name: 'clearStorage',
    run: (c) => clearStorage(c, 'temp'),
    command: 'mobile_home_clear_storage',
    args: { kind: 'temp' },
  },
  {
    name: 'clearStorage with keepDocKey',
    run: (c) => clearStorage(c, 'recovery', 'doc-1'),
    command: 'mobile_home_clear_storage',
    args: { kind: 'recovery', keepDocKey: 'doc-1' },
  },
  { name: 'appInfo', run: (c) => appInfo(c), command: 'mobile_home_app_info', args: undefined },
  {
    name: 'setKeepScreenOn',
    run: (c) => setKeepScreenOn(c, false),
    command: 'mobile_home_keep_screen_on',
    args: { on: false },
  },
  {
    name: 'openExternalUrl',
    run: (c) => openExternalUrl(c, 'https://ieumoffice.com'),
    command: 'mobile_home_open_external_url',
    args: { url: 'https://ieumoffice.com' },
  },
]

describe('home bridge wrappers', () => {
  it.each(CASES)('$name sends $command with the spec argument names', async (tc) => {
    const { client, invoke } = makeClient()
    await tc.run(client)
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke.mock.calls[0]![0]).toBe(tc.command)
    expect(invoke.mock.calls[0]![1]).toEqual(tc.args)
    if (tc.args) {
      expect(Object.keys(invoke.mock.calls[0]![1] as object).sort()).toEqual(
        Object.keys(tc.args).sort(),
      )
    }
  })

  it('sends readFileRefBytes as mobile_home_read_bytes with fileRef', async () => {
    const { client, invoke } = makeClient(() => ({ bytesBase64: '', name: 'a.pdf', mime: 'x' }))
    await readFileRefBytes(client, recentRef)
    expect(invoke).toHaveBeenCalledWith('mobile_home_read_bytes', { fileRef: recentRef })
  })

  it('leaves undefined optional arguments out of the payload', async () => {
    const { client, invoke } = makeClient()
    await linkFolder(client, undefined)
    await saveGroup(client, { name: 'A', id: undefined })
    await clearStorage(client, 'temp', undefined)
    for (const call of invoke.mock.calls) {
      const args = call[1] as Record<string, unknown>
      expect(Object.values(args)).not.toContain(undefined)
    }
    expect('replaceId' in (invoke.mock.calls[0]![1] as object)).toBe(false)
    expect('id' in (invoke.mock.calls[1]![1] as object)).toBe(false)
    expect('keepDocKey' in (invoke.mock.calls[2]![1] as object)).toBe(false)
  })
})

describe('non-array tolerance', () => {
  const listWrappers: ReadonlyArray<[string, (c: MobileClient) => Promise<unknown[]>]> = [
    ['listFolders', (c) => listFolders(c)],
    ['listFolder', (c) => listFolder(c, 'f1', [])],
    ['listFavorites', (c) => listFavorites(c)],
    ['setFavorite', (c) => setFavorite(c, recentRef, true)],
    ['listGroups', (c) => listGroups(c)],
    ['saveGroup', (c) => saveGroup(c, { name: 'A' })],
    ['deleteGroup', (c) => deleteGroup(c, 'g1')],
    ['moveToGroup', (c) => moveToGroup(c, [recentRef], null)],
    ['recentMeta', (c) => recentMeta(c)],
  ]

  it.each(listWrappers)('%s returns [] for { ok: true }', async (_name, run) => {
    const { client } = makeClient(() => ({ ok: true }))
    await expect(run(client)).resolves.toEqual([])
  })

  it.each(listWrappers)('%s returns [] for null', async (_name, run) => {
    const { client } = makeClient(() => null)
    await expect(run(client)).resolves.toEqual([])
  })

  it('passes an array answer through', async () => {
    const groups = [{ id: 'g1', name: 'Work' }]
    const { client } = makeClient(() => groups)
    await expect(listGroups(client)).resolves.toEqual(groups)
  })

  it('takeIncoming returns null for anything without an entries array', async () => {
    for (const answer of [{ ok: true }, null, undefined, [], { id: 'b1', entries: 'x' }]) {
      const { client } = makeClient(() => answer)
      await expect(takeIncoming(client)).resolves.toBeNull()
    }
  })

  it('takeIncoming returns the batch when it has an entries array', async () => {
    const batch = {
      id: 'b1',
      entries: [{ id: 'e1', name: 'a.jpg', mime: 'image/jpeg', isPicture: true }],
    }
    const { client } = makeClient(() => batch)
    await expect(takeIncoming(client)).resolves.toEqual(batch)
  })

  it('deleteFiles fills missing lists with []', async () => {
    const { client } = makeClient(() => ({ ok: true }))
    await expect(deleteFiles(client, [folderRef])).resolves.toEqual({ deleted: [], failed: [] })
  })

  it('duplicateFile turns a missing answer into null', async () => {
    const { client } = makeClient(() => undefined)
    await expect(duplicateFile(client, folderRef, 'copy')).resolves.toBeNull()
  })

  it('setKeepScreenOn resolves to undefined', async () => {
    const { client } = makeClient(() => ({ ok: true }))
    await expect(setKeepScreenOn(client, true)).resolves.toBeUndefined()
  })
})

describe('readFileRefBytes', () => {
  it('decodes base64 into bytes and keeps name and mime', async () => {
    const { client } = makeClient(() => ({
      bytesBase64: 'JVBERi0xLjQK/w==',
      name: 'a.pdf',
      mime: 'application/pdf',
    }))
    const res = await readFileRefBytes(client, recentRef)
    expect(res.bytes).toBeInstanceOf(Uint8Array)
    expect(Array.from(res.bytes)).toEqual([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0xff,
    ])
    expect(res.name).toBe('a.pdf')
    expect(res.mime).toBe('application/pdf')
  })

  it('decodes an empty string into empty bytes', async () => {
    const { client } = makeClient(() => ({
      bytesBase64: '',
      name: 'e.pdf',
      mime: 'application/pdf',
    }))
    const res = await readFileRefBytes(client, recentRef)
    expect(res.bytes.length).toBe(0)
  })

  it('rejects with a MobileCommandError when no bytes come back', async () => {
    const { client } = makeClient(() => ({ ok: true }))
    const err = await readFileRefBytes(client, recentRef).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MobileCommandError)
    expect((err as MobileCommandError).code).toBe('INTERNAL_ERROR')
  })
})

describe('errors', () => {
  it('passes the backend messageKey through as MobileCommandError', async () => {
    const { client } = makeClient(() => {
      throw { code: 'INVALID_ARGUMENT', messageKey: HOME_ERROR_KEYS.nameTaken }
    })
    const err = await renameFile(client, folderRef, 'x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MobileCommandError)
    expect((err as MobileCommandError).code).toBe('INVALID_ARGUMENT')
    expect((err as MobileCommandError).messageKey).toBe('mobile.home.nameTaken')
  })

  it('lists every mobile.home messageKey from the spec', () => {
    expect(Object.values(HOME_ERROR_KEYS).sort()).toEqual(
      [
        'mobile.home.folderLost',
        'mobile.home.groupNameInvalid',
        'mobile.home.groupNameTaken',
        'mobile.home.nameInvalid',
        'mobile.home.nameTaken',
        'mobile.home.notSupportedHere',
        'mobile.home.urlRefused',
      ].sort(),
    )
  })
})
