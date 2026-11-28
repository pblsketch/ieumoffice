/**
 * Crisp 24x24 line icons for the whiteboard workspace chrome (vertical tool rail,
 * header, bottom-left undo/zoom pills, dark floating format bar, and shape picker).
 */
import type { ReactElement, ReactNode } from 'react'
import type { ShapeKind } from '@genoffice/whiteboard-engine'
import { shapePath } from '../canvas/shape-paths'

interface IconProps {
  readonly size?: number
  readonly strokeWidth?: number
}

function makeIcon(paths: ReactNode, defaultStroke = 1.8) {
  return function LineIcon({ size = 20, strokeWidth = defaultStroke }: IconProps): ReactElement {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {paths}
      </svg>
    )
  }
}

export const SelectIcon = makeIcon(<path d="M5 3l13 6.5-5.5 1.8L10.5 17z" />)
export const StickyIcon = makeIcon(
  <>
    <path d="M4 4h16v10l-6 6H4z" />
    <path d="M14 20v-6h6" />
  </>,
)
export const TextIcon = makeIcon(
  <>
    <path d="M5 7V5h14v2" />
    <path d="M12 5v14" />
    <path d="M9 19h6" />
  </>,
)
export const ShapeIcon = makeIcon(
  <>
    <rect x="3" y="3" width="10" height="10" rx="1.5" />
    <circle cx="16.5" cy="16.5" r="4.5" />
  </>,
)
export const ConnectorIcon = makeIcon(
  <>
    <path d="M5 19L18 6" />
    <path d="M10 6h8v8" />
  </>,
)
export const PenIcon = makeIcon(
  <>
    <path d="M4 20l1-4L16 5l3 3L8 19z" />
    <path d="M13.5 7.5l3 3" />
  </>,
)
export const HighlighterIcon = makeIcon(
  <>
    <path d="M9 15l-4 4h5l2-2" />
    <path d="M9 15l7.5-9.5a2 2 0 0 1 3 0l.5.5a2 2 0 0 1 0 3L11 16.5z" />
    <path d="M4 21h16" />
  </>,
)
export const EraserIcon = makeIcon(
  <>
    <path d="M8.5 20H20" />
    <path d="M4.6 14.6l8.8-8.8a2 2 0 0 1 2.8 0l3 3a2 2 0 0 1 0 2.8L12.4 18.4a2 2 0 0 1-1.4.6H8a2 2 0 0 1-1.4-.6l-2-2a2 2 0 0 1 0-2.8z" />
    <path d="M9 10l5 5" />
  </>,
)
export const ImageIcon = makeIcon(
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="M21 16l-5-5-8 8" />
  </>,
)
export const TableIcon = makeIcon(
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
    <path d="M3.5 9.5h17M3.5 14.5h17M9.5 4.5v15M15 4.5v15" />
  </>,
)
export const StickerToolIcon = makeIcon(
  <path d="M12 3.5l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z" />,
)
export const LinkIcon = makeIcon(
  <>
    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l2.2-2.2a4.5 4.5 0 0 0-6.4-6.4L10.8 6.8" />
    <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-2.2 2.2a4.5 4.5 0 0 0 6.4 6.4l1.4-1.4" />
  </>,
)
export const PdfIcon = makeIcon(
  <>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4" />
    <path d="M9 13h6M9 16.5h4" />
  </>,
)
export const UndoIcon = makeIcon(
  <>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h11a5 5 0 0 1 0 10h-4" />
  </>,
)
export const RedoIcon = makeIcon(
  <>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H9a5 5 0 0 0 0 10h4" />
  </>,
)
export const MinusIcon = makeIcon(<path d="M5 12h14" />, 2)
export const PlusIcon = makeIcon(
  <>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </>,
  2,
)
export const FitIcon = makeIcon(
  <>
    <path d="M4 9V4h5" />
    <path d="M20 9V4h-5" />
    <path d="M4 15v5h5" />
    <path d="M20 15v5h-5" />
  </>,
)
export const PresentIcon = makeIcon(
  <>
    <rect x="3" y="4" width="18" height="12" rx="1.5" />
    <path d="M12 16v4" />
    <path d="M8 20h8" />
    <path d="M10.5 8l3.5 2-3.5 2z" />
  </>,
)
export const ExportIcon = makeIcon(
  <>
    <path d="M12 4v11" />
    <path d="M7.5 10.5L12 15l4.5-4.5" />
    <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
  </>,
)
export const PrintIcon = makeIcon(
  <>
    <path d="M6 9V4h12v5" />
    <rect x="4" y="9" width="16" height="8" rx="1.5" />
    <path d="M7 14h10v6H7z" />
  </>,
)
export const FrontIcon = makeIcon(
  <>
    <path d="M7 11l5-5 5 5" />
    <path d="M7 17l5-5 5 5" />
  </>,
)
export const BackIcon = makeIcon(
  <>
    <path d="M7 7l5 5 5-5" />
    <path d="M7 13l5 5 5-5" />
  </>,
)
export const DuplicateIcon = makeIcon(
  <>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
  </>,
)
export const TrashIcon = makeIcon(
  <>
    <path d="M4 7h16" />
    <path d="M9 7V4h6v3" />
    <path d="M6 7l1 13h10l1-13" />
  </>,
)
export const AlignLeftIcon = makeIcon(
  <>
    <path d="M4 6h16" />
    <path d="M4 12h11" />
    <path d="M4 18h14" />
  </>,
)
export const AlignCenterIcon = makeIcon(
  <>
    <path d="M4 6h16" />
    <path d="M6.5 12h11" />
    <path d="M5 18h14" />
  </>,
)
export const AlignRightIcon = makeIcon(
  <>
    <path d="M4 6h16" />
    <path d="M9 12h11" />
    <path d="M6 18h14" />
  </>,
)
export const SolidLineIcon = makeIcon(<path d="M4 12h16" />, 2)
export const DashedLineIcon = makeIcon(<path d="M4 12h4M10.5 12h3M16 12h4" />, 2)
export const DottedLineIcon = makeIcon(
  <>
    <circle cx="5.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="10" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="14.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </>,
)
export const StraightRouteIcon = makeIcon(<path d="M5 18L19 6" />, 1.9)
export const CurvedRouteIcon = makeIcon(<path d="M5 18C11 18 13 6 19 6" />, 1.9)
export const ElbowRouteIcon = makeIcon(<path d="M5 18h5a2 2 0 0 0 2-2V8a2 2 0 0 1 2-2h5" />, 1.9)
export const ArrowStartIcon = makeIcon(
  <>
    <path d="M20 12H6" />
    <path d="M11 7l-5 5 5 5" />
  </>,
)
export const ArrowEndIcon = makeIcon(
  <>
    <path d="M4 12h14" />
    <path d="M13 7l5 5-5 5" />
  </>,
)
export const StealthStartIcon = makeIcon(
  <>
    <path d="M20 12H9" />
    <path d="M4.5 12L12 7.5L10.3 12L12 16.5Z" fill="currentColor" stroke="none" />
  </>,
)
export const StealthEndIcon = makeIcon(
  <>
    <path d="M4 12h11" />
    <path d="M19.5 12L12 7.5L13.7 12L12 16.5Z" fill="currentColor" stroke="none" />
  </>,
)
export const CircleStartIcon = makeIcon(
  <>
    <path d="M20 12H10" />
    <circle cx="7" cy="12" r="3" />
  </>,
)
export const CircleEndIcon = makeIcon(
  <>
    <path d="M4 12h10" />
    <circle cx="17" cy="12" r="3" />
  </>,
)
export const LineEndIcon = makeIcon(<path d="M5 12h14" />, 2)
export const TextBgIcon = makeIcon(
  <>
    <rect x="3.5" y="5" width="17" height="14" rx="3" />
    <path d="M8 9.5h8M12 9.5v5.5" />
  </>,
)
export const HandIcon = makeIcon(
  <>
    <path d="M18 11V6a1.5 1.5 0 0 0-3 0v4" />
    <path d="M15 10V5a1.5 1.5 0 0 0-3 0v5" />
    <path d="M12 10V6a1.5 1.5 0 0 0-3 0v6" />
    <path d="M9 12v-1a1.5 1.5 0 0 0-3 0v4a6 6 0 0 0 6 6h2a5 5 0 0 0 5-5v-5a1.5 1.5 0 0 0-3 0" />
  </>,
)
export const TemplateIcon = makeIcon(
  <>
    <rect x="3.5" y="4" width="17" height="16" rx="2" />
    <path d="M3.5 9.5h17M10 9.5V20" />
  </>,
)
export const SearchIcon = makeIcon(
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </>,
)
export const GroupIcon = makeIcon(
  <>
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
    <path d="M11 7.5h4a1.5 1.5 0 0 1 1.5 1.5v4" />
    <path d="M13 16.5H9a1.5 1.5 0 0 1-1.5-1.5v-4" />
  </>,
)
export const UngroupIcon = makeIcon(
  <>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    <path d="M14 5l5 5M19 5l-5 5" />
  </>,
)
export const LockIcon = makeIcon(
  <>
    <rect x="5" y="11" width="14" height="9.5" rx="2" />
    <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
  </>,
)
export const UnlockIcon = makeIcon(
  <>
    <rect x="5" y="11" width="14" height="9.5" rx="2" />
    <path d="M8 11V7.5a4 4 0 0 1 7.4-2" />
  </>,
)
export const AlignObjLeftIcon = makeIcon(
  <>
    <path d="M4 4v16" />
    <rect x="7.5" y="6" width="12" height="4" rx="1" />
    <rect x="7.5" y="14" width="8" height="4" rx="1" />
  </>,
)
export const AlignObjCenterHIcon = makeIcon(
  <>
    <path d="M12 4v16" />
    <rect x="5" y="6" width="14" height="4" rx="1" />
    <rect x="7.5" y="14" width="9" height="4" rx="1" />
  </>,
)
export const AlignObjRightIcon = makeIcon(
  <>
    <path d="M20 4v16" />
    <rect x="4.5" y="6" width="12" height="4" rx="1" />
    <rect x="8.5" y="14" width="8" height="4" rx="1" />
  </>,
)
export const AlignObjTopIcon = makeIcon(
  <>
    <path d="M4 4h16" />
    <rect x="6" y="7.5" width="4" height="12" rx="1" />
    <rect x="14" y="7.5" width="4" height="8" rx="1" />
  </>,
)
export const AlignObjMiddleVIcon = makeIcon(
  <>
    <path d="M4 12h16" />
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="7.5" width="4" height="9" rx="1" />
  </>,
)
export const AlignObjBottomIcon = makeIcon(
  <>
    <path d="M4 20h16" />
    <rect x="6" y="4.5" width="4" height="12" rx="1" />
    <rect x="14" y="8.5" width="4" height="8" rx="1" />
  </>,
)
export const DistributeHIcon = makeIcon(
  <>
    <path d="M4 4v16M20 4v16" />
    <rect x="9.5" y="6.5" width="5" height="11" rx="1" />
  </>,
)
export const DistributeVIcon = makeIcon(
  <>
    <path d="M4 4h16M4 20h16" />
    <rect x="6.5" y="9.5" width="11" height="5" rx="1" />
  </>,
)
export const GridDotIcon = makeIcon(
  <>
    <circle cx="6" cy="6" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="6" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="18" cy="6" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="18" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="6" cy="18" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="18" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="18" cy="18" r="1.2" fill="currentColor" stroke="none" />
  </>,
)
export const GridLineIcon = makeIcon(
  <>
    <path d="M4 9h16M4 15h16M9 4v16M15 4v16" />
  </>,
)
export const GridBlankIcon = makeIcon(<rect x="4" y="4" width="16" height="16" rx="2" />)
export const MinimapIcon = makeIcon(
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <rect x="11" y="10" width="6.5" height="6.5" rx="1" />
  </>,
)
export const ChevronUpIcon = makeIcon(<path d="M6 15l6-6 6 6" />)
export const ChevronDownIcon = makeIcon(<path d="M6 9l6 6 6-6" />)
export const CloseIcon = makeIcon(<path d="M6 6l12 12M18 6L6 18" />)
export const CopyIcon = makeIcon(
  <>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </>,
)
export const RotateIcon = makeIcon(
  <>
    <path d="M20 12a8 8 0 1 1-2.3-5.7" />
    <path d="M20 4v5h-5" />
  </>,
)

export function ShapeKindGlyph({
  kind,
  size = 20,
}: {
  kind: ShapeKind
  size?: number
}): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <g transform="translate(3, 4)">
        <path d={shapePath(kind, 18, 16, 1)} />
      </g>
    </svg>
  )
}
