import { useEffect, useMemo, useRef, useState } from 'react'
import { htmlDir, htmlLang, isLang, type Lang } from '@genoffice/i18n'
import type {
  QuickSwitcherBridge,
  QuickSwitcherGroup,
  QuickSwitcherItem,
} from '../../shared/quick-switcher-api'
import { quickSwitcherText } from './i18n/strings-quick-switcher'
import './quick-switcher.css'

declare global {
  interface Window {
    aiOfficeQuickSwitcher?: QuickSwitcherBridge
  }
}

const GROUP_ORDER: readonly QuickSwitcherGroup[] = [
  'open-tab',
  'recent-file',
  'project-file',
  'command',
]

function groupTitle(lang: Lang, group: QuickSwitcherGroup): string {
  switch (group) {
    case 'open-tab':
      return quickSwitcherText(lang, 'groupOpenTab')
    case 'recent-file':
      return quickSwitcherText(lang, 'groupRecentFile')
    case 'project-file':
      return quickSwitcherText(lang, 'groupProjectFile')
    case 'command':
      return quickSwitcherText(lang, 'groupCommand')
  }
}

export function QuickSwitcher() {
  const [lang, setLang] = useState<Lang>('ko')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<readonly QuickSwitcherItem[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    void window.aiOfficeQuickSwitcher?.lang().then((l) => {
      if (isLang(l)) {
        setLang(l)
        document.documentElement.lang = htmlLang(l)
        document.documentElement.dir = htmlDir(l)
      }
    })
    void window.aiOfficeQuickSwitcher?.theme().then((t) => {
      if (t === 'light' || t === 'dark') {
        document.documentElement.setAttribute('data-theme', t)
      } else {
        document.documentElement.removeAttribute('data-theme')
      }
    })
  }, [])

  useEffect(() => {
    let live = true
    void window.aiOfficeQuickSwitcher?.query(query).then((res) => {
      if (!live) return
      setItems(res.items)
      setActiveIndex(0)
    })
    return () => {
      live = false
    }
  }, [query])

  const grouped = useMemo(() => {
    const out: Array<{
      group: QuickSwitcherGroup
      rows: Array<{ item: QuickSwitcherItem; index: number }>
    }> = []
    let idx = 0
    for (const g of GROUP_ORDER) {
      const matching = items.filter((i) => i.group === g)
      if (matching.length === 0) continue
      out.push({
        group: g,
        rows: matching.map((item) => ({ item, index: idx++ })),
      })
    }
    return out
  }, [items])

  const flat = useMemo(() => grouped.flatMap((g) => g.rows.map((r) => r.item)), [grouped])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      void window.aiOfficeQuickSwitcher?.close()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (flat.length > 0) setActiveIndex((i) => (i + 1) % flat.length)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (flat.length > 0) setActiveIndex((i) => (i - 1 + flat.length) % flat.length)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const chosen = flat[activeIndex]
      if (chosen) void window.aiOfficeQuickSwitcher?.execute(chosen.id)
    }
  }

  return (
    <div className="qs-shell" onKeyDown={onKeyDown}>
      <div className="qs-input-wrap">
        <input
          ref={inputRef}
          type="text"
          className="qs-input"
          value={query}
          placeholder={quickSwitcherText(lang, 'placeholder')}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="qs-list" role="listbox">
        {flat.length === 0 ? (
          <div className="qs-empty">{quickSwitcherText(lang, 'empty')}</div>
        ) : (
          grouped.map((section) => (
            <div key={section.group}>
              <div className="qs-group-label">{groupTitle(lang, section.group)}</div>
              {section.rows.map(({ item, index }) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`qs-row${index === activeIndex ? ' qs-row-active' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => void window.aiOfficeQuickSwitcher?.execute(item.id)}
                >
                  <span className="qs-row-main">
                    <span className="qs-row-title">{item.title}</span>
                    {item.subtitle && <span className="qs-row-sub">{item.subtitle}</span>}
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
      <div className="qs-footer">{quickSwitcherText(lang, 'hint')}</div>
    </div>
  )
}
