// The [Tools] tab of the home (PDF tools, track T3): the tools list in the tab; picking a tool opens
// the full-screen tools layer on that tool's files, and closing it comes back to the tab.
// Registers the PDF tools flow with T6's home layer so [+] create, multi-select, and receive use it.
import { useRef, useState, type ComponentType } from 'react'
import type { MobilePdfToolId } from '../tools/catalog'
import { PdfToolsFlow, pdfToolsLink } from '../tools/link'
import { ToolsList } from '../tools/ToolsList'
import type { HomeTabProps } from './homeTabs'
import { providePdfToolsLink } from './pdfToolsLink'

providePdfToolsLink(pdfToolsLink)

function ToolsTabView({ host }: HomeTabProps) {
  const [tool, setTool] = useState<MobilePdfToolId | null>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  const close = () => {
    setTool(null)
    const opener = openerRef.current
    openerRef.current = null
    // focus goes back to the card that opened the tool
    if (opener?.isConnected) queueMicrotask(() => opener.focus())
  }

  return (
    <>
      <ToolsList
        host={host}
        onPickTool={(picked) => {
          openerRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null
          setTool(picked)
        }}
      />
      {tool && <PdfToolsFlow host={host} start={{ kind: 'tool', tool }} onClose={close} />}
    </>
  )
}

export const ToolsTab: ComponentType<HomeTabProps> = ToolsTabView
