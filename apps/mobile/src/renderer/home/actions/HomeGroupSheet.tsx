import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import {
  deleteGroup,
  listGroups,
  moveToGroup,
  saveGroup,
  type FavoriteGroup,
} from '@genoffice/mobile-bridge/home'
import type { MobileClient } from '@genoffice/mobile-bridge/transport'
import { HomeActRenameIcon, HomeActTrashIcon } from '../../components/icons/home'
import { IconCheck } from '../../components/MobileIcons'
import { Sheet } from '../../components/Sheet'
import { useMobileLocale, type MobileStringKey } from '../../i18n'
import { homeActErrorKeyOf } from './items'
import type { HomeFileItem } from './types'
import './homeActions.css'

export interface HomeGroupSheetProps {
  readonly open: boolean
  /** Null (tests, no app layer): the sheet shows only "no group" and "new group". */
  readonly client: MobileClient | null
  /** Starred files to move. */
  readonly items: readonly HomeFileItem[]
  readonly onClose: () => void
  /** After the files moved (`groupId` null = no group). The caller closes the sheet. */
  readonly onMoved: (groupId: string | null) => void
  /** After a group was created, renamed or deleted (group chips change). */
  readonly onGroupsChanged?: () => void
}

type Editing = { readonly mode: 'new' } | { readonly mode: 'rename'; readonly id: string } | null

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * "Move to group" sheet (spec 3.4): the groups, "new group" and "no group"; each group can be
 * renamed or deleted here. Deleting a group keeps its files starred, without a group.
 */
export function HomeGroupSheet({
  open,
  client,
  items,
  onClose,
  onMoved,
  onGroupsChanged,
}: HomeGroupSheetProps) {
  const { t } = useMobileLocale()
  const [groups, setGroups] = useState<readonly FavoriteGroup[]>([])
  const [editing, setEditing] = useState<Editing>(null)
  const [draft, setDraft] = useState('')
  const [errorKey, setErrorKey] = useState<MobileStringKey | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const errorId = useId()

  useEffect(() => {
    if (!open) return
    setEditing(null)
    setErrorKey(null)
    setGroups([])
    if (!client) return
    let alive = true
    listGroups(client).then(
      (list) => {
        if (alive) setGroups(list)
      },
      (err: unknown) => {
        if (alive) setErrorKey(homeActErrorKeyOf(err))
      },
    )
    return () => {
      alive = false
    }
  }, [open, client])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const groupIds = new Set(items.map((item) => item.groupId ?? null))
  const current = groupIds.size === 1 ? [...groupIds][0] : undefined

  const run = async (task: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setErrorKey(null)
    try {
      await task()
    } catch (err) {
      setErrorKey(homeActErrorKeyOf(err))
    } finally {
      setBusy(false)
    }
  }

  const move = (groupId: string | null) =>
    run(async () => {
      if (!client) return
      await moveToGroup(
        client,
        items.map((item) => item.fileRef),
        groupId,
      )
      onMoved(groupId)
    })

  const submitName = (event: FormEvent) => {
    event.preventDefault()
    const name = draft.trim()
    const target = editing
    if (!target) return
    if (name.length === 0) {
      setErrorKey('homeActGroupNameInvalid')
      return
    }
    const clash = groups.some(
      (group) => sameName(group.name, name) && (target.mode === 'new' || group.id !== target.id),
    )
    if (clash) {
      setErrorKey('homeActGroupNameTaken')
      return
    }
    void run(async () => {
      if (!client) return
      if (target.mode === 'rename') {
        setGroups(await saveGroup(client, { id: target.id, name }))
        setEditing(null)
        onGroupsChanged?.()
        return
      }
      const before = new Set(groups.map((group) => group.id))
      const next = await saveGroup(client, { name })
      setGroups(next)
      setEditing(null)
      onGroupsChanged?.()
      // A group made from this sheet takes the files at once.
      const created = next.find((group) => !before.has(group.id))
      if (created) {
        await moveToGroup(
          client,
          items.map((item) => item.fileRef),
          created.id,
        )
        onMoved(created.id)
      }
    })
  }

  const remove = (id: string) =>
    run(async () => {
      if (!client) return
      setGroups(await deleteGroup(client, id))
      onGroupsChanged?.()
    })

  const nameForm = (
    <form className="home-act-form" onSubmit={submitName}>
      <input
        ref={inputRef}
        className="mobile-input"
        data-testid="home-act-group-name-input"
        aria-label={t('homeActGroupName')}
        placeholder={t('homeActGroupName')}
        aria-invalid={errorKey !== null}
        aria-describedby={errorKey ? errorId : undefined}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          setErrorKey(null)
        }}
        autoComplete="off"
      />
      <div className="home-act-form-actions">
        <button
          type="button"
          className="mobile-touch-btn mobile-btn-ghost"
          onClick={() => {
            setEditing(null)
            setErrorKey(null)
          }}
        >
          {t('homeActCancel')}
        </button>
        <button
          type="submit"
          className="mobile-touch-btn mobile-btn-primary"
          data-testid="home-act-group-name-submit"
          disabled={busy}
        >
          {editing?.mode === 'rename' ? t('homeActRenameSave') : t('homeActGroupCreate')}
        </button>
      </div>
    </form>
  )

  return (
    <Sheet
      open={open}
      title={t('homeActMoveToGroup')}
      closeLabel={t('homeActCancel')}
      onClose={onClose}
      testId="home-act-group-sheet"
    >
      <div className="mobile-menu-stack">
        <button
          type="button"
          className="mobile-menu-row-btn"
          data-testid="home-act-group-none"
          aria-current={current === null ? 'true' : undefined}
          disabled={busy}
          onClick={() => void move(null)}
        >
          <span className="home-act-group-name">{t('homeActGroupNone')}</span>
          {current === null && <IconCheck size={18} />}
        </button>
        {groups.map((group) =>
          editing?.mode === 'rename' && editing.id === group.id ? (
            <div key={group.id} className="home-act-group-edit">
              {nameForm}
            </div>
          ) : (
            <div key={group.id} className="home-act-group-row">
              <button
                type="button"
                className="mobile-menu-row-btn"
                data-testid={`home-act-group-${group.id}`}
                aria-current={current === group.id ? 'true' : undefined}
                disabled={busy}
                onClick={() => void move(group.id)}
              >
                <span className="home-act-group-name">{group.name}</span>
                {current === group.id && <IconCheck size={18} />}
              </button>
              <button
                type="button"
                className="mobile-icon-btn"
                aria-label={t('homeActGroupRenameOne', { name: group.name })}
                title={t('homeActGroupRenameOne', { name: group.name })}
                disabled={busy}
                onClick={() => {
                  setDraft(group.name)
                  setErrorKey(null)
                  setEditing({ mode: 'rename', id: group.id })
                }}
              >
                <HomeActRenameIcon size={18} />
              </button>
              <button
                type="button"
                className="mobile-icon-btn"
                aria-label={t('homeActGroupDeleteOne', { name: group.name })}
                title={t('homeActGroupDeleteOne', { name: group.name })}
                disabled={busy}
                onClick={() => void remove(group.id)}
              >
                <HomeActTrashIcon size={18} />
              </button>
            </div>
          ),
        )}
        {editing?.mode === 'new' ? (
          <div className="home-act-group-edit">{nameForm}</div>
        ) : (
          <button
            type="button"
            className="mobile-menu-row-btn"
            data-testid="home-act-group-new"
            disabled={busy}
            onClick={() => {
              setDraft('')
              setErrorKey(null)
              setEditing({ mode: 'new' })
            }}
          >
            <span className="home-act-group-name">+ {t('homeActGroupNew')}</span>
          </button>
        )}
        {errorKey && (
          <p id={errorId} className="home-act-form-error" role="alert">
            {t(errorKey)}
          </p>
        )}
      </div>
    </Sheet>
  )
}
