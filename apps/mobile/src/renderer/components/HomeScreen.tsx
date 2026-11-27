import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  linkFolder,
  openFavorite,
  openSample,
  type FavoriteEntry,
} from '@genoffice/mobile-bridge/home'
import {
  isMobileCommandError,
  type MobileDocFormat,
  type RecentDocEntry,
  type RecoveryEntry,
} from '@genoffice/mobile-bridge/transport'
import { EDITOR_KINDS } from '../editors/registry'
import {
  favoriteFileItem,
  HomeFileRow,
  HomeSelectionBar,
  HomeSelectionHeader,
  homeActErrorKeyOf,
  recentFileItem,
  useHomeFileActions,
  useHomeSelection,
  type HomeFileItem,
  type UseHomeFileActionsOptions,
} from '../home/actions'
import {
  chipListsFavorites,
  filterFavorites,
  filterRecent,
  getLastHomeTab,
  homeCardList,
  homeChips,
  rememberHomeTab,
  sortFavoriteEntries,
  sortRecentEntries,
  useHomeListPrefs,
  type HomeContentTabId,
} from '../home/frame/frameModel'
import { chipLabel, HomeChips } from '../home/frame/HomeChips'
import { HomeCards } from '../home/frame/HomeCards'
import { HomeCreateSheet, HomeFab } from '../home/frame/HomeCreateSheet'
import { HomeEmpty } from '../home/frame/HomeEmpty'
import { HomeListToolbar } from '../home/frame/HomeListToolbar'
import { HomeTabBar } from '../home/frame/HomeTabBar'
import { HomeToolFlowLayer } from '../home/frame/HomeToolFlowLayer'
import { useHomeListData } from '../home/frame/useHomeListData'
import '../home/frame/homeFrame.css'
import type { HomeHost } from '../home/homeHost'
import { bumpFoldersRevision, markSessionOrigin, useActiveFolderPath } from '../home/homeRuntime'
import { HOME_TABS, visibleHomeTabs, type HomeTabId } from '../home/homeTabs'
import { usePdfToolsLink, type PdfToolStart } from '../home/pdfToolsLink'
import { ensureLoaded, PDF_TOOLS_ID, useHomePrefs } from '../home/prefsStore'
import { useMobileLocale } from '../i18n'
import { useViewportLayout } from '../shell/useViewportLayout'
import { DocTypeIcon, IconSettings, IeumAppIcon } from './MobileIcons'

const NO_ITEMS: readonly HomeFileItem[] = []

export interface HomeScreenProps {
  readonly recentDocs: readonly RecentDocEntry[]
  readonly recoveryEntries: readonly RecoveryEntry[]
  readonly permissionDeniedRecentId: string | null
  readonly defaultHwpFormat: 'hwp' | 'hwpx'
  /** Creates an untitled document of a card's format (the HWP card follows `defaultHwpFormat`). */
  readonly onCreateNew: (format: MobileDocFormat) => void
  readonly onOpenFile: () => void
  readonly onOpenRecent: (entry: RecentDocEntry) => void
  readonly onRemoveRecent: (id: string) => void
  readonly onRestoreRecovery: (entry: RecoveryEntry) => void
  readonly onDiscardRecovery: (docKey: string) => void
  readonly onOpenSettings: () => void
  /**
   * What the tabs, lists and sheets ask of the app. Without it the home draws only the recent tab
   * (cards, recent list, create sheet) and leaves out what needs the bridge.
   */
  readonly host?: HomeHost
}

/**
 * The home (spec 3.1-3.3): [Recent] [Folders] [Tools] [Settings] as bottom tabs on compact windows
 * and as a left rail from medium up, the [+] create sheet, and T3's tools screen above it all.
 */
export function HomeScreen({
  recentDocs,
  recoveryEntries,
  permissionDeniedRecentId,
  defaultHwpFormat,
  onCreateNew,
  onOpenFile,
  onOpenRecent,
  onRemoveRecent,
  onRestoreRecovery,
  onDiscardRecovery,
  onOpenSettings,
  host,
}: HomeScreenProps) {
  const { lang, t } = useMobileLocale()
  const { windowClass } = useViewportLayout()
  const { prefs, isEditorOn } = useHomePrefs()
  const link = usePdfToolsLink()
  const client = host?.client ?? null

  useEffect(() => {
    void ensureLoaded(client)
  }, [client])

  const recent = useMemo(() => (Array.isArray(recentDocs) ? recentDocs : []), [recentDocs])
  const { data, reload } = useHomeListData(client, recent)

  // ── Tabs ──
  const tabs = host ? visibleHomeTabs(isEditorOn) : []
  const [tabState, setTabState] = useState<HomeContentTabId>(() =>
    host ? getLastHomeTab() : 'recent',
  )
  const tab: HomeContentTabId = tabs.some((def) => def.id === tabState) ? tabState : 'recent'
  const rail = tabs.length > 0 && windowClass !== 'compact'

  // ── Cards, sheet, tools ──
  const cards = homeCardList(EDITOR_KINDS, prefs, isEditorOn)
  const pdfToolsReady = host !== undefined && link !== null && isEditorOn(PDF_TOOLS_ID)
  const [createOpen, setCreateOpen] = useState(false)
  const [flowStart, setFlowStart] = useState<PdfToolStart | null>(null)
  const activeFolderPath = useActiveFolderPath()
  const listPrefs = useHomeListPrefs()

  // ── Chips and lists ──
  const chips = useMemo(
    () => homeChips(recent, data.groups, EDITOR_KINDS, client !== null),
    [recent, data.groups, client],
  )
  const [chipId, setChipId] = useState('all')
  const chip = chips.find((item) => item.id === chipId) ?? chips[0]
  const showFavorites = chipListsFavorites(chip)

  const favoriteByDocKey = useMemo(
    () => new Map(data.favorites.map((entry) => [entry.docKey, entry])),
    [data.favorites],
  )
  const shownRecent = useMemo(
    () => sortRecentEntries(filterRecent(recent, chip), listPrefs.sortField, listPrefs.sortDir),
    [recent, chip, listPrefs.sortField, listPrefs.sortDir],
  )
  const recentItems = useMemo(
    () =>
      shownRecent.map((entry) => {
        const favorite = favoriteByDocKey.get(entry.docKey)
        return recentFileItem(entry, {
          favorite: favorite !== undefined,
          groupId: favorite?.groupId ?? null,
          location: data.recentLocation.get(entry.id),
        })
      }),
    [shownRecent, favoriteByDocKey, data.recentLocation],
  )
  const shownFavorites = useMemo(
    () =>
      sortFavoriteEntries(
        filterFavorites(data.favorites, chip),
        listPrefs.sortField,
        listPrefs.sortDir,
      ),
    [data.favorites, chip, listPrefs.sortField, listPrefs.sortDir],
  )
  const favoriteItems = useMemo(
    () =>
      shownFavorites.map((entry) =>
        favoriteFileItem(entry, {
          location: entry.folderId ? data.folderNames.get(entry.folderId) : undefined,
        }),
      ),
    [shownFavorites, data.folderNames],
  )
  const items = showFavorites ? favoriteItems : recentItems
  const selection = useHomeSelection(tab === 'recent' ? items : NO_ITEMS)

  const refreshLists = useCallback(() => {
    void reload()
    void host?.refreshHome()
  }, [host, reload])

  const actionOptions: Omit<UseHomeFileActionsOptions, 'listKind'> = {
    host,
    onChanged: refreshLists,
    onOpenPdfTool: setFlowStart,
    onStartSelect: (item) => selection.start(item.key),
    onSelectionDone: selection.clear,
  }
  const recentActions = useHomeFileActions({ ...actionOptions, listKind: 'recent' })
  const favoriteActions = useHomeFileActions({ ...actionOptions, listKind: 'favorites' })
  const actions = showFavorites ? favoriteActions : recentActions

  const toastError = (err: unknown, lostKey?: 'homeListFavoriteLost') => {
    if (!host) return
    if (isMobileCommandError(err)) {
      if (err.code === 'USER_CANCELLED') return
      if (
        lostKey &&
        (err.code === 'PERMISSION_DENIED' || err.messageKey === 'mobile.home.notFound')
      ) {
        host.showToast({ message: t(lostKey), tone: 'error' })
        return
      }
    }
    const key = homeActErrorKeyOf(err)
    if (key) host.showToast({ message: t(key), tone: 'error' })
  }

  const openFavoriteEntry = async (entry: FavoriteEntry) => {
    const inRecent = recent.find((doc) => doc.docKey === entry.docKey)
    if (inRecent) {
      onOpenRecent(inRecent)
      return
    }
    if (!host) return
    try {
      const session = await openFavorite(host.client, entry.docKey)
      await host.openSession(session)
    } catch (err) {
      toastError(err, 'homeListFavoriteLost')
    }
  }

  const openSampleDoc = async () => {
    if (!host) return
    try {
      const session = await openSample(host.client, lang)
      markSessionOrigin(session.sessionId, 'sample')
      await host.openSession(session)
    } catch (err) {
      toastError(err)
    }
  }

  const addLinkedFolder = async () => {
    if (!client) return
    try {
      await linkFolder(client)
      bumpFoldersRevision()
      refreshLists()
    } catch (err) {
      toastError(err)
    }
  }

  const selectTab = (id: HomeTabId) => {
    if (id === 'settings') {
      if (host) host.openSettings()
      else onOpenSettings()
      return
    }
    selection.clear()
    rememberHomeTab(id)
    setTabState(id)
  }

  const selectChip = (id: string) => {
    selection.clear()
    setChipId(id)
  }

  /** Rows follow the shown entries one to one, so a row's index finds its entry. */
  const openItem = (index: number) => {
    if (showFavorites) {
      const entry = shownFavorites[index]
      if (entry) void openFavoriteEntry(entry)
      return
    }
    const entry = shownRecent[index]
    if (entry) onOpenRecent(entry)
  }

  const listTitle = showFavorites ? chipLabel(chip, t) : t('recentDocs')
  const listCount = showFavorites ? shownFavorites.length : recent.length

  const recentBody = (
    <main className="mobile-page-body home-frame-body">
      {recoveryEntries.length > 0 && (
        <section
          className="mobile-card mobile-recovery-banner"
          aria-label={t('recoveryBannerTitle')}
          data-testid="home-recovery-banner"
        >
          <h2 className="mobile-section-title">{t('recoveryBannerTitle')}</h2>
          <ul className="mobile-list">
            {recoveryEntries.map((entry) => (
              <li key={entry.docKey} className="mobile-list-item-col">
                <div className="mobile-list-row">
                  <div className="mobile-list-meta">
                    <DocTypeIcon format={entry.format} size={26} />
                    <span className="mobile-list-name">{entry.title}</span>
                    <span className="mobile-badge">{entry.format.toUpperCase()}</span>
                  </div>
                </div>
                <div className="mobile-row-actions">
                  <button
                    type="button"
                    className="mobile-touch-btn mobile-btn-primary"
                    onClick={() => onRestoreRecovery(entry)}
                  >
                    {t('recoveryRestore')}
                  </button>
                  <button
                    type="button"
                    className="mobile-touch-btn mobile-btn-ghost"
                    onClick={() => onDiscardRecovery(entry.docKey)}
                  >
                    {t('recoveryDiscard')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <HomeCards
        cards={cards}
        hwpFormat={defaultHwpFormat}
        onCreate={onCreateNew}
        onOpenFile={onOpenFile}
      />

      <section className="mobile-section" aria-label={listTitle}>
        <div className="mobile-section-bar">
          <div className="mobile-section-heading-wrap">
            <h2 className="mobile-section-heading">{listTitle}</h2>
            {listCount > 0 && <span className="mobile-section-count">{listCount}</span>}
          </div>
        </div>
        {chips.length > 1 && <HomeChips chips={chips} current={chip.id} onSelect={selectChip} />}
        {items.length > 0 && !selection.selecting && <HomeListToolbar />}

        {!showFavorites && recent.length === 0 ? (
          <HomeEmpty
            onOpenSample={host ? () => void openSampleDoc() : undefined}
            onOpenFile={onOpenFile}
            onCreate={() => setCreateOpen(true)}
          />
        ) : items.length === 0 ? (
          <p className="mobile-muted home-frame-list-empty" data-testid="home-list-empty">
            {chip.kind === 'group' ? t('homeListGroupEmpty') : t('homeListFavoritesEmpty')}
          </p>
        ) : (
          <ul
            className="mobile-doc-list"
            data-view={listPrefs.viewMode}
            data-testid={showFavorites ? 'home-favorites-list' : 'home-recent-list'}
          >
            {items.map((item, index) => {
              const entry = showFavorites ? undefined : shownRecent[index]
              const expired = entry !== undefined && permissionDeniedRecentId === entry.id
              return (
                <HomeFileRow
                  key={item.key}
                  item={item}
                  client={client}
                  selecting={selection.selecting}
                  selected={selection.isSelected(item.key)}
                  onOpen={() => openItem(index)}
                  onToggleSelect={() => selection.toggle(item.key)}
                  onStartSelect={() => selection.start(item.key)}
                  onOpenMenu={() => actions.openRowMenu(item)}
                  footer={
                    expired && entry ? (
                      <div
                        className="mobile-inline-alert mobile-doc-inline-alert"
                        role="alert"
                        data-testid={`recent-expired-${entry.id}`}
                      >
                        <p className="mobile-alert-text">{t('recentPermissionExpired')}</p>
                        <div className="mobile-row-actions">
                          <button
                            type="button"
                            className="mobile-touch-btn mobile-btn-secondary"
                            onClick={onOpenFile}
                          >
                            {t('repickFile')}
                          </button>
                          <button
                            type="button"
                            className="mobile-touch-btn mobile-btn-ghost"
                            onClick={() => onRemoveRecent(entry.id)}
                          >
                            {t('removeFromRecent')}
                          </button>
                        </div>
                      </div>
                    ) : undefined
                  }
                />
              )
            })}
          </ul>
        )}
      </section>
    </main>
  )

  const TabContent = tab === 'recent' ? null : HOME_TABS.find((def) => def.id === tab)?.Component
  const selecting = tab === 'recent' && selection.selecting
  const showFab = (tab === 'recent' || tab === 'folders') && !selecting

  const tabBar =
    tabs.length > 0 ? (
      <HomeTabBar
        tabs={tabs}
        current={tab}
        variant={rail ? 'rail' : 'bottom'}
        onSelect={selectTab}
      />
    ) : null

  return (
    <div
      className="mobile-page home-frame"
      data-testid="mobile-home-screen"
      data-layout={rail ? 'rail' : 'bottom'}
    >
      {rail && tabBar}
      <div className="home-frame-main">
        {selecting ? (
          <HomeSelectionHeader count={selection.selectedKeys.length} onClose={selection.clear} />
        ) : (
          <header className="mobile-appbar">
            <div className="mobile-brand-wrap">
              <IeumAppIcon size={28} />
              <h1 className="mobile-appbar-title">{t('appTitle')}</h1>
            </div>
            {tabs.length === 0 && (
              <button
                type="button"
                className="mobile-icon-btn"
                onClick={onOpenSettings}
                aria-label={t('settings')}
                title={t('settings')}
                data-testid="home-settings-btn"
              >
                <IconSettings size={21} />
              </button>
            )}
          </header>
        )}

        {TabContent && host ? (
          <main className="home-frame-panel" data-testid={`home-panel-${tab}`}>
            <TabContent host={host} />
          </main>
        ) : (
          recentBody
        )}

        {showFab && <HomeFab onPress={() => setCreateOpen(true)} />}

        {selecting ? (
          <HomeSelectionBar
            listKind={showFavorites ? 'favorites' : 'recent'}
            items={selection.selectedItems}
            onAction={(action) => actions.runBulk(action, selection.selectedItems)}
          />
        ) : (
          !rail && tabBar
        )}
      </div>

      {recentActions.element}
      {favoriteActions.element}

      <HomeCreateSheet
        open={createOpen}
        cards={cards}
        hwpFormat={defaultHwpFormat}
        pdfToolsReady={pdfToolsReady}
        locationLabel={tab === 'folders' ? activeFolderPath : null}
        onClose={() => setCreateOpen(false)}
        onCreate={onCreateNew}
        onOpenFile={onOpenFile}
        onOpenPdfTools={() => setFlowStart({ kind: 'menu' })}
        onAddFolder={client ? () => void addLinkedFolder() : undefined}
      />

      {flowStart && link && host && (
        <HomeToolFlowLayer
          link={link}
          host={host}
          start={flowStart}
          onClose={() => setFlowStart(null)}
        />
      )}
    </div>
  )
}
