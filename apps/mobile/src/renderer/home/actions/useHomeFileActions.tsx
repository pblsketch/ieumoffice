import { useRef, useState, type ReactNode } from 'react'
import {
  appInfo,
  deleteFiles,
  duplicateFile,
  renameFile,
  setFavorite,
  shareFiles,
  type AppPlatform,
} from '@genoffice/mobile-bridge/home'
import type { MobileClient } from '@genoffice/mobile-bridge/transport'
import { useMobileLocale } from '../../i18n'
import { useHomeRuntime } from '../homeRuntime'
import type { PdfToolStart } from '../pdfToolsLink'
import { HomeDeleteConfirm } from './HomeConfirmDialog'
import { HomeGroupSheet } from './HomeGroupSheet'
import { HomeRenameSheet } from './HomeRenameSheet'
import { HomeRowMenu } from './HomeRowMenu'
import { buildPdfToolStart, homeActErrorKey, homeActErrorKeyOf } from './items'
import type {
  HomeActionChange,
  HomeActionsHost,
  HomeBulkAction,
  HomeFileItem,
  HomeListKind,
  HomeRowAction,
} from './types'

const platforms = new WeakMap<MobileClient, Promise<AppPlatform>>()

/** The platform from the app info, asked once per client; 'other' when unknown. */
function platformOf(client: MobileClient | null): Promise<AppPlatform> {
  if (!client) return Promise.resolve('other')
  let known = platforms.get(client)
  if (!known) {
    known = appInfo(client).then(
      (info) => {
        const platform = (info as { platform?: unknown } | null)?.platform
        return platform === 'android' || platform === 'ios' ? platform : 'other'
      },
      () => 'other' as const,
    )
    platforms.set(client, known)
  }
  return known
}

export interface UseHomeFileActionsOptions {
  readonly listKind: HomeListKind
  /** The app's client and toast. Left out: the runtime host; null: none (actions do nothing). */
  readonly host?: HomeActionsHost | null
  /** After an action changed files or lists; without it the host's `refreshHome()` runs. */
  readonly onChanged?: (change: HomeActionChange) => void
  /** [merge] / [make PDF]: the parent draws T3's Flow with this start. */
  readonly onOpenPdfTool?: (start: PdfToolStart) => void
  /** The row menu's "Select": enter selection with this row picked. */
  readonly onStartSelect?: (item: HomeFileItem) => void
  /** A bar action finished; the list leaves selection. */
  readonly onSelectionDone?: () => void
}

export interface HomeFileActions {
  /** Opens the row's [⋯] menu. */
  openRowMenu(item: HomeFileItem): void
  runRow(action: HomeRowAction, item: HomeFileItem): void
  /** Runs a selection bar action on the picked rows (in pick order). */
  runBulk(action: HomeBulkAction, items: readonly HomeFileItem[]): void
  /** The menu, sheets and confirm dialog; render it once next to the list. */
  readonly element: ReactNode
}

interface PendingDelete {
  readonly items: readonly HomeFileItem[]
  readonly platform: AppPlatform
  readonly bulk: boolean
}

interface PendingGroup {
  readonly items: readonly HomeFileItem[]
  readonly bulk: boolean
}

/**
 * Runs the home file actions through the bridge (spec 3.4, 3.6, 3.7): asks where needed, shows
 * the result as a toast through the host, and reports the change so the list can read again.
 */
export function useHomeFileActions(options: UseHomeFileActionsOptions): HomeFileActions {
  const { t } = useMobileLocale()
  const runtime = useHomeRuntime()
  const host = options.host === undefined ? runtime : options.host
  const [menuItem, setMenuItem] = useState<HomeFileItem | null>(null)
  const [renaming, setRenaming] = useState<HomeFileItem | null>(null)
  const [grouping, setGrouping] = useState<PendingGroup | null>(null)
  const [deleting, setDeleting] = useState<PendingDelete | null>(null)

  // Handlers read the latest props and strings without re-creating callbacks.
  const live = useRef({ options, host, t })
  live.current = { options, host, t }

  const toast = (key: Parameters<typeof t>[0], params?: Parameters<typeof t>[1]) => {
    const { host: h, t: tr } = live.current
    h?.showToast(tr(key, params))
  }

  const fail = (err: unknown) => {
    const key = homeActErrorKeyOf(err)
    if (!key) return
    const { host: h, t: tr } = live.current
    h?.showToast({ message: tr(key), tone: 'error' })
  }

  const changed = (change: HomeActionChange) => {
    const { options: o, host: h } = live.current
    if (o.onChanged) o.onChanged(change)
    else void h?.refreshHome?.()
  }

  const done = (bulk: boolean) => {
    if (bulk) live.current.options.onSelectionDone?.()
  }

  const refsOf = (items: readonly HomeFileItem[]) => items.map((item) => item.fileRef)

  const share = async (items: readonly HomeFileItem[], bulk: boolean) => {
    const client = live.current.host?.client
    if (!client) return
    try {
      await shareFiles(client, refsOf(items))
      done(bulk)
    } catch (err) {
      fail(err)
    }
  }

  const duplicate = async (item: HomeFileItem) => {
    const client = live.current.host?.client
    if (!client) return
    try {
      const copy = await duplicateFile(client, item.fileRef, live.current.t('homeActCopySuffix'))
      if (!copy) return
      toast('homeActDuplicated')
      changed('duplicate')
    } catch (err) {
      fail(err)
    }
  }

  const favorite = async (items: readonly HomeFileItem[], on: boolean, bulk: boolean) => {
    const client = live.current.host?.client
    if (!client) return
    try {
      for (const item of items) await setFavorite(client, item.fileRef, on)
      toast(on ? 'homeActFavoriteAdded' : 'homeActFavoriteRemoved')
      changed('favorite')
      done(bulk)
    } catch (err) {
      fail(err)
      changed('favorite')
    }
  }

  const removeFromList = async (items: readonly HomeFileItem[], bulk: boolean) => {
    const client = live.current.host?.client
    if (!client) return
    try {
      for (const item of items) {
        const ref = item.fileRef
        if (live.current.options.listKind === 'favorites') {
          await setFavorite(client, ref, false)
        } else if (ref.kind === 'recent') {
          await client.removeRecentDoc(ref.id)
        }
      }
      toast('homeActRemoved')
      changed('removeFromList')
      done(bulk)
    } catch (err) {
      fail(err)
      changed('removeFromList')
    }
  }

  const askDelete = async (items: readonly HomeFileItem[], bulk: boolean) => {
    if (items.length === 0) return
    const platform = await platformOf(live.current.host?.client ?? null)
    setDeleting({ items, platform, bulk })
  }

  const confirmDelete = async (pending: PendingDelete) => {
    setDeleting(null)
    const client = live.current.host?.client
    if (!client) return
    try {
      const result = await deleteFiles(client, refsOf(pending.items))
      if (result.failed.length === 0) {
        toast('homeActDeleted', { count: result.deleted.length })
      } else {
        const { host: h, t: tr } = live.current
        const reason = tr(homeActErrorKey(result.failed[0]?.messageKey))
        const summary = tr('homeActDeletePartial', {
          deleted: result.deleted.length,
          failed: result.failed.length,
        })
        h?.showToast({ message: `${summary} ${reason}`, tone: 'error' })
      }
      changed('delete')
      done(pending.bulk)
    } catch (err) {
      fail(err)
    }
  }

  const openTool = (kind: 'merge' | 'imagesToPdf', items: readonly HomeFileItem[]) => {
    const client = live.current.host?.client
    const open = live.current.options.onOpenPdfTool
    if (!client || !open || items.length === 0) return
    open(buildPdfToolStart(kind, items, client))
    done(true)
  }

  const runRow = (action: HomeRowAction, item: HomeFileItem) => {
    switch (action) {
      case 'select':
        live.current.options.onStartSelect?.(item)
        return
      case 'share':
        void share([item], false)
        return
      case 'rename':
        setRenaming(item)
        return
      case 'duplicate':
        void duplicate(item)
        return
      case 'favoriteAdd':
      case 'favoriteRemove':
        void favorite([item], action === 'favoriteAdd', false)
        return
      case 'moveToGroup':
        setGrouping({ items: [item], bulk: false })
        return
      case 'removeFromList':
        void removeFromList([item], false)
        return
      case 'delete':
        void askDelete([item], false)
        return
    }
  }

  const runBulk = (action: HomeBulkAction, items: readonly HomeFileItem[]) => {
    switch (action) {
      case 'share':
        void share(items, true)
        return
      case 'removeFromList':
        void removeFromList(items, true)
        return
      case 'delete':
        void askDelete(items, true)
        return
      case 'favoriteAdd':
      case 'favoriteRemove':
        void favorite(items, action === 'favoriteAdd', true)
        return
      case 'moveToGroup':
        setGrouping({ items, bulk: true })
        return
      case 'merge':
      case 'imagesToPdf':
        openTool(action, items)
        return
    }
  }

  const rename = async (item: HomeFileItem, newBaseName: string) => {
    const client = live.current.host?.client
    if (!client) throw new Error('no client')
    await renameFile(client, item.fileRef, newBaseName)
    setRenaming(null)
    toast('homeActRenamed')
    changed('rename')
  }

  const element = (
    <>
      <HomeRowMenu
        item={menuItem}
        listKind={options.listKind}
        onClose={() => setMenuItem(null)}
        onAction={runRow}
      />
      <HomeRenameSheet
        open={renaming !== null}
        name={renaming?.name ?? ''}
        onClose={() => setRenaming(null)}
        onRename={(base) => (renaming ? rename(renaming, base) : Promise.resolve())}
      />
      <HomeGroupSheet
        open={grouping !== null}
        client={host?.client ?? null}
        items={grouping?.items ?? []}
        onClose={() => setGrouping(null)}
        onMoved={() => {
          const bulk = grouping?.bulk ?? false
          setGrouping(null)
          toast('homeActMoved')
          changed('group')
          done(bulk)
        }}
        onGroupsChanged={() => changed('groups')}
      />
      <HomeDeleteConfirm
        open={deleting !== null}
        count={deleting?.items.length ?? 0}
        name={deleting?.items[0]?.name}
        platform={deleting?.platform ?? 'other'}
        onConfirm={() => {
          if (deleting) void confirmDelete(deleting)
        }}
        onCancel={() => setDeleting(null)}
      />
    </>
  )

  return { openRowMenu: setMenuItem, runRow, runBulk, element }
}
