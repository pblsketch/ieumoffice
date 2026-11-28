import { useCallback, useEffect, useRef, useState } from 'react'
import { htmlLang, type Lang } from '@genoffice/i18n'
import { IconCheck } from '@genoffice/ui/icons'
import type { DriveEntry, DriveListingRequest } from '../../../shared/drive-api'
import type { DrivePickerApi } from '../../../shared/drive-picker-api'
import { DRIVE_ERROR_KEYS } from '../DriveBrowser'
import { FAILURE_KEYS } from '../drive-failures'
import { DRIVE_ENTRY_ICONS } from '../drive-icons'
import { driveUiText, type DriveStringKey } from '../i18n/strings-drive'

/** How many Drive files one attach may carry (matches MAX_ATTACH_FILES) */
export const DRIVE_PICK_MAX = 20

function OtherIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M5 2.5h6.5L15 6v11.5H5z M11.5 2.5V6H15"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Tick already-chosen Drive files to attach to the asking editor's AI panel,
 * without opening the browser again. When the needed files are not in the list
 * yet, "Add from Google Drive" opens Google's picker, reloads the list, and
 * pre-ticks the newly added files.
 */
export function DrivePickerWindow({ lang, api }: { lang: Lang; api: DrivePickerApi }) {
  const t = (key: DriveStringKey, params?: Record<string, string>) => driveUiText(lang, key, params)
  const dateLocale = htmlLang(lang)
  const [query, setQuery] = useState('')
  const [searched, setSearched] = useState<string | null>(null)
  const [files, setFiles] = useState<DriveEntry[]>([])
  const [nextPage, setNextPage] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<DriveStringKey | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pickingMore, setPickingMore] = useState(false)
  const [working, setWorking] = useState(false)
  const [notice, setNotice] = useState<{ key: DriveStringKey; warn?: boolean } | null>(null)
  const request = useRef(0)
  const pendingAutoSelect = useRef<readonly string[] | null>(null)

  const listing = useCallback(
    (): DriveListingRequest => (searched ? { kind: 'search', text: searched } : { kind: 'recent' }),
    [searched],
  )

  const load = useCallback(
    async (more?: string) => {
      const id = ++request.current
      setLoading(true)
      setError(null)
      const result = await api.list(listing(), more).catch(() => null)
      if (id !== request.current) return
      setLoading(false)
      if (!result || !result.ok) {
        setError(DRIVE_ERROR_KEYS[result?.kind ?? 'network'])
        if (!more) setFiles([])
        return
      }
      setFiles((prev) => (more ? [...prev, ...result.files] : result.files))
      setNextPage(result.nextPageToken)
      const autoSelectIds = !more ? pendingAutoSelect.current : null
      if (autoSelectIds) {
        pendingAutoSelect.current = null
        if (autoSelectIds.length > 0) {
          const openable = new Set(result.files.filter((f) => f.openable).map((f) => f.id))
          setSelected((prev) => {
            const next = new Set(prev)
            for (const pickedId of autoSelectIds) {
              if (next.size >= DRIVE_PICK_MAX) break
              if (openable.has(pickedId)) next.add(pickedId)
            }
            return next
          })
        }
      }
    },
    [api, listing],
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !working) void api.cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [api, working])

  const toggle = (entry: DriveEntry) => {
    if (!entry.openable) {
      setNotice({ key: 'driveUnsupported' })
      return
    }
    if (!selected.has(entry.id) && selected.size >= DRIVE_PICK_MAX) {
      setNotice({ key: 'drivePickerLimit', warn: true })
      return
    }
    setNotice(null)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(entry.id)) next.delete(entry.id)
      else next.add(entry.id)
      return next
    })
  }

  const pickMore = async () => {
    if (pickingMore || working) return
    setPickingMore(true)
    setNotice(null)
    setError(null)
    const result = await api.pickMore().catch(() => null)
    setPickingMore(false)
    if (!result) {
      setError('driveErrNetwork')
      return
    }
    if (!result.ok) {
      if (result.reason === 'cancelled' || result.reason === 'busy') return
      if (result.reason === 'not-connected') setError('driveErrNotConnected')
      else setError(FAILURE_KEYS[result.reason])
      return
    }
    pendingAutoSelect.current = result.picked
    setQuery('')
    if (searched !== null) {
      setSearched(null)
    } else {
      await load()
    }
  }

  const attach = async () => {
    if (working || pickingMore || selected.size === 0) return
    setWorking(true)
    setNotice(null)
    const result = await api.choose([...selected]).catch(() => null)
    // on success main closes this window
    if (!result || !result.ok) {
      setWorking(false)
      setNotice({ key: 'driveErrNetwork', warn: true })
    }
  }

  return (
    <div className="drp">
      <div className="drp-head">
        <form
          className="drp-search"
          onSubmit={(e) => {
            e.preventDefault()
            setSearched(query.trim() || null)
          }}
        >
          <input
            type="search"
            value={query}
            placeholder={t('driveSearchPlaceholder')}
            aria-label={t('driveSearchPlaceholder')}
            disabled={working}
            onChange={(e) => {
              const value = e.target.value
              setQuery(value)
              if (!value.trim() && searched !== null) setSearched(null)
            }}
          />
        </form>
        <button
          type="button"
          className="drp-ghost"
          onClick={() => void pickMore()}
          disabled={working || pickingMore}
        >
          {t('drivePickMore')}
        </button>
      </div>

      <div className="drp-subbar">
        {searched ? (
          <span>
            <button
              type="button"
              className="drp-crumb"
              onClick={() => {
                setSearched(null)
                setQuery('')
              }}
            >
              {t('driveRecent')}
            </button>
            {' › '}
            {t('driveSearchResults', { q: searched })}
          </span>
        ) : (
          <span>{t('driveRecent')}</span>
        )}
        <button
          type="button"
          className="drp-crumb"
          onClick={() => void load()}
          disabled={loading || working}
        >
          {t('driveRefresh')}
        </button>
      </div>

      <div className="drp-body">
        {pickingMore && <p className="drp-note">{t('drivePicking')}</p>}
        {error && (
          <p className="drp-warn" role="alert">
            {t(error)}
          </p>
        )}
        <ul className="drp-list" aria-busy={loading}>
          {files.map((entry) => {
            const picked = selected.has(entry.id)
            const blocked = !entry.openable
            const icon = DRIVE_ENTRY_ICONS[entry.type]
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  className={`drp-item${blocked ? ' dim' : ''}${picked ? ' picked' : ''}`}
                  onClick={() => toggle(entry)}
                  disabled={working}
                  aria-disabled={blocked}
                  aria-pressed={picked}
                  title={blocked ? t('driveUnsupported') : undefined}
                >
                  <span className="drp-check" aria-hidden="true">
                    {picked && <IconCheck size={12} />}
                  </span>
                  <span className="drp-icon">
                    {icon ? <img src={icon} alt="" width={18} height={18} /> : <OtherIcon />}
                  </span>
                  <span className="drp-name">{entry.name}</span>
                  {entry.google && <span className="drp-badge">{t('driveGoogleBadge')}</span>}
                  {!entry.canEdit && <span className="drp-badge">{t('driveReadOnly')}</span>}
                  <span className="drp-date">
                    {entry.modifiedTime
                      ? new Date(entry.modifiedTime).toLocaleDateString(dateLocale)
                      : ''}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        {!loading && files.length === 0 && !error && (
          <p className="drp-note">{t(searched ? 'drivePickerNoMatches' : 'drivePickerEmpty')}</p>
        )}
        {loading && <p className="drp-note">{t('driveLoading')}</p>}
        {!loading && nextPage && (
          <button
            type="button"
            className="drp-ghost drp-more"
            onClick={() => void load(nextPage)}
            disabled={working}
          >
            {t('driveLoadMore')}
          </button>
        )}
      </div>

      <div className="drp-foot">
        <span className={`drp-count${notice?.warn ? ' warn' : ''}`}>
          {working
            ? t('drivePickerWorking')
            : notice
              ? t(notice.key, { max: String(DRIVE_PICK_MAX) })
              : t('drivePickerSelected', { n: String(selected.size) })}
        </span>
        <button
          type="button"
          className="drp-ghost"
          onClick={() => void api.cancel()}
          disabled={working}
        >
          {t('driveCancel')}
        </button>
        <button
          type="button"
          className="drp-primary"
          onClick={() => void attach()}
          disabled={working || pickingMore || selected.size === 0}
        >
          {t('drivePickerAttach')}
        </button>
      </div>
    </div>
  )
}
