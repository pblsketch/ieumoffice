import React, { useEffect, useRef, useState } from 'react'
import { htmlDir, htmlLang, type Lang } from '@genoffice/i18n'
import type { QuickLookNavState, QuickLookPayload } from '../../../shared/quick-look-api'
import { QuickLookView } from './QuickLookView'

const DEFAULT_NAV: QuickLookNavState = {
  enabled: false,
  canPrev: false,
  canNext: false,
  direction: 'none',
  origin: 'explorer',
}

export interface QuickLookWindowProps {
  initialLang: Lang
  initialPayload: QuickLookPayload | null
  initialNav?: QuickLookNavState
}

export function QuickLookWindow({
  initialLang,
  initialPayload,
  initialNav,
}: QuickLookWindowProps): React.JSX.Element {
  const [lang, setLang] = useState<Lang>(initialLang)
  const [payload, setPayload] = useState<QuickLookPayload | null>(initialPayload)
  const [nav, setNav] = useState<QuickLookNavState>(initialNav ?? DEFAULT_NAV)
  const [closing, setClosing] = useState(false)
  const [openCycle, setOpenCycle] = useState(0)
  const navRef = useRef(nav)
  navRef.current = nav

  useEffect(() => {
    const api = window.aiOfficeQuickLook
    if (!api) return
    const offUpdate = api.onUpdate((next) => setPayload(next))
    const offNav = api.onNavChanged((nextNav) => setNav(nextNav))
    const offWillShow = api.onWillShow(() => {
      setClosing(false)
      setOpenCycle((n) => n + 1)
    })
    const offWillHide = api.onWillHide(() => {
      setClosing(true)
    })
    const offLang = api.onLangChanged((nextLang) => {
      setLang(nextLang)
      document.documentElement.lang = htmlLang(nextLang)
      document.documentElement.dir = htmlDir(nextLang)
    })
    return () => {
      offUpdate()
      offNav()
      offWillShow()
      offWillHide()
      offLang()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape' || e.key === ' ') {
        e.preventDefault()
        e.stopPropagation()
        setClosing(true)
        void window.aiOfficeQuickLook?.close()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        setClosing(true)
        void window.aiOfficeQuickLook?.openInEditor()
      } else if (e.key === 'ArrowUp' && navRef.current.enabled && navRef.current.canPrev) {
        e.preventDefault()
        e.stopPropagation()
        void window.aiOfficeQuickLook?.step(-1)
      } else if (e.key === 'ArrowDown' && navRef.current.enabled && navRef.current.canNext) {
        e.preventDefault()
        e.stopPropagation()
        void window.aiOfficeQuickLook?.step(1)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  return (
    <QuickLookView
      key={openCycle}
      lang={lang}
      payload={payload}
      standalone
      origin={nav.origin}
      closing={closing}
      navDirection={nav.direction}
      listIndex={nav.index}
      listTotal={nav.total}
      canPrev={nav.canPrev}
      canNext={nav.canNext}
      onPrev={nav.enabled ? () => void window.aiOfficeQuickLook?.step(-1) : undefined}
      onNext={nav.enabled ? () => void window.aiOfficeQuickLook?.step(1) : undefined}
      onOpenInEditor={() => {
        setClosing(true)
        void window.aiOfficeQuickLook?.openInEditor()
      }}
      onRevealInFolder={() => {
        void window.aiOfficeQuickLook?.revealInFolder()
      }}
      onClose={() => {
        setClosing(true)
        void window.aiOfficeQuickLook?.close()
      }}
    />
  )
}
