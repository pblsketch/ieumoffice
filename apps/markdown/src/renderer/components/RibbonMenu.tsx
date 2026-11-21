import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { useDismissablePopover } from '@genoffice/ui'

import { IconCaret } from './icons'

type SelectCommand = (command: () => void) => void

const escapeClosers: (() => void)[] = []

function closeTopOnEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  escapeClosers.at(-1)?.()
}

export function RibbonMenu({
  label,
  icon,
  alignEnd,
  submenu,
  arrowOnly,
  disabled,
  children,
}: {
  label: string
  icon?: ReactNode
  alignEnd?: boolean
  submenu?: boolean
  arrowOnly?: boolean
  disabled?: boolean
  children: (select: SelectCommand) => ReactNode
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const focusEdge = useRef<'first' | 'last' | null>(null)
  const expanded = open && !disabled

  const enabledItems = () =>
    Array.from(
      panelRef.current?.querySelectorAll<HTMLButtonElement>(
        ':scope > .rb-menu-item:enabled, :scope > .rb-menu-wrap > .rb-menu-item:enabled',
      ) ?? [],
    )
  const close = useCallback(() => {
    if (panelRef.current?.contains(document.activeElement)) triggerRef.current?.focus()
    setOpen(false)
  }, [])

  useDismissablePopover(expanded, () => setOpen(false), { inside: () => [wrapRef.current] })
  useLayoutEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])
  useLayoutEffect(() => {
    if (!expanded) return
    const edge = focusEdge.current
    focusEdge.current = null
    if (edge) {
      const items = enabledItems()
      items.at(edge === 'first' ? 0 : -1)?.focus()
    }
    escapeClosers.push(close)
    if (escapeClosers.length === 1) window.addEventListener('keydown', closeTopOnEscape)
    return () => {
      escapeClosers.splice(escapeClosers.indexOf(close), 1)
      if (!escapeClosers.length) window.removeEventListener('keydown', closeTopOnEscape)
    }
  }, [expanded, close])

  const onKeyDown = (event: ReactKeyboardEvent) => {
    const end = event.key === 'End'
    const start = event.key === 'Home'
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (event.target === triggerRef.current && !expanded && step && !submenu) {
      event.preventDefault()
      focusEdge.current = step === 1 ? 'first' : 'last'
      setOpen(true)
      return
    }
    if (!expanded || !(step || start || end)) return
    event.preventDefault()
    event.stopPropagation()
    const items = enabledItems()
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      end || (current < 0 && step === -1)
        ? items.length - 1
        : start
          ? 0
          : (current + step + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <div
      ref={wrapRef}
      role={submenu ? 'none' : undefined}
      className={`rb-menu-wrap${alignEnd ? ' align-end' : ''}${submenu ? ' submenu' : ''}`}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false)
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={
          submenu ? 'rb-menu-item rb-submenu-trigger' : 'rb-btn rb-menu-trigger rb-labeled'
        }
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={expanded}
        aria-controls={expanded ? id : undefined}
        role={submenu ? 'menuitem' : undefined}
        tabIndex={submenu ? -1 : undefined}
        data-tip={submenu ? undefined : label}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          if (expanded) close()
          else {
            focusEdge.current = event.detail === 0 ? 'first' : null
            setOpen(true)
          }
        }}
      >
        {icon}
        {!arrowOnly && <span className="rb-label">{label}</span>}
        <IconCaret size={12} />
      </button>
      {expanded && (
        <div ref={panelRef} className="rb-menu" role="menu" aria-label={label} id={id}>
          {children((command) => {
            close()
            command()
          })}
        </div>
      )}
    </div>
  )
}

export function RibbonMenuItem({
  label,
  icon,
  checked,
  radio,
  disabled,
  onClick,
  children,
}: {
  label: string
  icon?: ReactNode
  checked?: boolean
  radio?: boolean
  disabled?: boolean
  onClick: () => void
  children?: ReactNode
}) {
  return (
    <button
      type="button"
      className="rb-menu-item"
      role={radio ? 'menuitemradio' : checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked}
      tabIndex={-1}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {icon}
      <span>{children ?? label}</span>
      {checked && (
        <span className="rb-menu-check" aria-hidden="true">
          ✓
        </span>
      )}
    </button>
  )
}
