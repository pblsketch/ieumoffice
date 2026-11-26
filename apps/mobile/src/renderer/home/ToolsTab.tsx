// The [Tools] tab of the home (PDF tools, track T3): the tools list in the tab; picking a tool opens
// the full-screen tools layer on that tool's files, and closing it comes back to the tab.
// Once T6 is merged, `providePdfToolsLink(pdfToolsLink)` (tools/link.ts) goes at the top of this
// module (docs/plans/mobile-v1/T3.md, the merge notes).
import { useRef, useState, type ComponentType } from 'react'
import type { MobilePdfToolId } from '../tools/catalog'
import { PdfToolsFlow } from '../tools/link'
import { ToolsList } from '../tools/ToolsList'
import type { HomeTabProps } from './homeTabs'

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
