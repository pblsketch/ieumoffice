// Icons of track T6 home. Draw them with SvgIcon from './svgIcon' (not from MobileIcons, which
// imports this folder's index). File-type pictures go in the map below.
import { SvgIcon, type IconProps } from './svgIcon'
import type { DocTypeIconMap } from './types'

export const homeDocTypeIcons: DocTypeIconMap = {}

// HOME-T7 file actions (home/actions)
/** Favorite mark; pass `fill="currentColor"` for the filled (starred) shape. */
export function HomeActStarIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <polygon points="12 2.8 14.9 8.7 21.4 9.6 16.7 14.2 17.8 20.6 12 17.6 6.2 20.6 7.3 14.2 2.6 9.6 9.1 8.7 12 2.8" />
    </SvgIcon>
  )
}

export function HomeActRenameIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" />
      <line x1="13.5" y1="7.5" x2="16.5" y2="10.5" />
    </SvgIcon>
  )
}

export function HomeActCopyIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </SvgIcon>
  )
}

export function HomeActTrashIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </SvgIcon>
  )
}

export function HomeActGroupIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="12 11 14.5 13.5 12 16" />
      <line x1="8" y1="13.5" x2="14.5" y2="13.5" />
    </SvgIcon>
  )
}

export function HomeActRemoveIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <line x1="4" y1="7" x2="14" y2="7" />
      <line x1="4" y1="12" x2="12" y2="12" />
      <line x1="4" y1="17" x2="10" y2="17" />
      <line x1="15" y1="14" x2="20" y2="19" />
      <line x1="20" y1="14" x2="15" y2="19" />
    </SvgIcon>
  )
}

export function HomeActSelectIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <polyline points="8 12 11 15 16 9" />
    </SvgIcon>
  )
}

/** Selection mark of a picked row (shape, not only color). */
export function HomeActCheckedIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="12" r="9" fill="currentColor" />
      <polyline points="8 12.5 11 15.5 16.5 9.5" stroke="var(--surface)" />
    </SvgIcon>
  )
}

/** Selection mark of a row that is not picked. */
export function HomeActUncheckedIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="12" r="9" />
    </SvgIcon>
  )
}

export function HomeActMergeIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M6 3v5a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4v5" />
      <path d="M18 3v5a4 4 0 0 1-4 4" />
      <polyline points="15 18 18 21 21 18" />
    </SvgIcon>
  )
}

export function HomeActImagesToPdfIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <circle cx="9.5" cy="12.5" r="1.5" />
      <polyline points="19 19 14.5 14.5 7 22" />
    </SvgIcon>
  )
}

// HOME-T6 home frame (home/frame)
/** The [Tools] tab: a wrench. */
export function HomeFrameToolsIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M14.7 6.3a4 4 0 0 0 5 5L21 12.6a6 6 0 0 1-7.6 1.6L7 20.6a2 2 0 0 1-2.8-2.8l6.4-6.4A6 6 0 0 1 12.2 3.8z" />
    </SvgIcon>
  )
}

/** The [+] button and "new" tiles. */
export function HomeFramePlusIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </SvgIcon>
  )
}

/** The sample document button: an open book. */
export function HomeFrameSampleIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M3 5.5A1.5 1.5 0 0 1 4.5 4H9a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H4.5A1.5 1.5 0 0 1 3 16z" />
      <path d="M21 5.5A1.5 1.5 0 0 0 19.5 4H15a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5h5a1.5 1.5 0 0 0 1.5-1.5z" />
    </SvgIcon>
  )
}
