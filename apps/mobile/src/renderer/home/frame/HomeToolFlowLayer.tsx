import type { HomeHost } from '../homeHost'
import type { PdfToolStart, PdfToolsLink } from '../pdfToolsLink'
import './homeFrame.css'

export interface HomeToolFlowLayerProps {
  readonly link: PdfToolsLink
  readonly host: HomeHost
  readonly start: PdfToolStart
  readonly onClose: () => void
}

/**
 * T3's tools screen drawn full screen above the home (spec 3.18). The screen's own back layers,
 * progress and result sheet belong to T3; it calls `onClose` when it closes (Back included).
 */
export function HomeToolFlowLayer({ link, host, start, onClose }: HomeToolFlowLayerProps) {
  const { Flow } = link
  return (
    <div className="home-frame-flow" data-testid="home-tool-flow">
      <Flow host={host} start={start} onClose={onClose} />
    </div>
  )
}
