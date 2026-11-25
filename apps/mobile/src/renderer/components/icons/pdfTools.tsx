// Icons of track T3 pdf tools. Draw them with SvgIcon from './svgIcon' (not from MobileIcons, which
// imports this folder's index). File-type pictures go in the map below.
// The tool glyphs copy the PC PDF editor ribbon icons (apps/pdf/src/renderer/icons.tsx) so a tool
// looks the same on the phone and on the PC.
import type { ReactElement } from 'react'
import { SvgIcon, type IconProps } from './svgIcon'
import type { DocTypeIconMap } from './types'

export const pdfToolsDocTypeIcons: DocTypeIconMap = {}

/** Every card of the mobile PDF tools list: the PC tool ids plus `edit` (edit & sign). */
export type PdfToolsIconId =
  | 'merge'
  | 'split'
  | 'extract'
  | 'reverse'
  | 'rotate'
  | 'blankPages'
  | 'imagesToPdf'
  | 'toText'
  | 'compress'
  | 'encrypt'
  | 'decrypt'
  | 'repair'
  | 'stripAnnots'
  | 'edit'

// PC IconMergePdf
export function PdfToolsMergeIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M4.5 6.5 H8.5 V17.5 H4.5 Z" />
      <path d="M15.5 6.5 H19.5 V17.5 H15.5 Z" />
      <path d="M10 9 L12 12 L10 15 M14 9 L12 12 L14 15" />
    </SvgIcon>
  )
}

// PC IconSplitPdf
export function PdfToolsSplitIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="4.5" y="6.5" width="6.2" height="11" rx="0.8" />
      <rect x="13.3" y="6.5" width="6.2" height="11" rx="0.8" />
      <path d="M12 4.6 V7 M12 9.4 V11.8 M12 14.2 V16.6 M12 19 V19.4" />
    </SvgIcon>
  )
}

// PC IconExtract
export function PdfToolsExtractIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M7.2 4.5 H13.2 L16.7 8 V11.5" />
      <path d="M6.2 5.5 V18.5 A1 1 0 0 0 7.2 19.5 H11.2" />
      <path d="M14.95 13.5 V19 M12.2 16.5 L14.95 19.25 L17.7 16.5" />
    </SvgIcon>
  )
}

// PC IconReverse
export function PdfToolsReverseIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M9 5.5 L9 18 M6.5 8 L9 5.5 L11.5 8" />
      <path d="M15 6 L15 18.5 M12.5 16 L15 18.5 L17.5 16" />
    </SvgIcon>
  )
}

// PC IconRotateAll
export function PdfToolsRotateIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="8.5" y="8.5" width="7" height="9" rx="0.8" />
      <path d="M6.2 6.2 A 8.2 8.2 0 0 1 17.8 6.2" />
      <path d="M17.8 3.4 L17.8 6.4 L14.8 6.4" />
      <path d="M17.8 17.8 A 8.2 8.2 0 0 1 6.2 17.8" />
      <path d="M6.2 20.6 L6.2 17.6 L9.2 17.6" />
    </SvgIcon>
  )
}

// PC IconBlankPages
export function PdfToolsBlankPagesIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="4.5" y="4.5" width="10" height="14" rx="1" strokeDasharray="2.2 1.8" />
      <circle cx="15.5" cy="14.5" r="3.2" />
      <path d="M17.8 16.8 L20.2 19.2" />
    </SvgIcon>
  )
}

// PC IconImagesToPdf
export function PdfToolsImagesToPdfIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M7.5 5.5 A1 1 0 0 1 8.5 4.5 H18.5 A1 1 0 0 1 19.5 5.5 V13.5" />
      <rect x="4.5" y="7.5" width="12" height="11" rx="1" />
      <circle cx="8.4" cy="11" r="1.1" />
      <path d="M4.8 16.6 L8.6 13.7 L11.6 15.9 L13.6 14.4 L16.2 16.4" />
    </SvgIcon>
  )
}

// PC IconToText
export function PdfToolsToTextIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M7.7 4.5 H13.7 L17.2 8 V18.5 A1 1 0 0 1 16.2 19.5 H7.7 A1 1 0 0 1 6.7 18.5 V5.5 A1 1 0 0 1 7.7 4.5 Z" />
      <path d="M13.7 4.5 V8 H17.2" />
      <path d="M9.45 11.25 H14.45 M9.45 13.75 H14.45 M9.45 16.25 H12.45" />
    </SvgIcon>
  )
}

// PC IconCompress
export function PdfToolsCompressIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="8" y="4.5" width="8" height="15" rx="1" />
      <path d="M3.5 12 H6.2 M5 10.6 L6.4 12 L5 13.4 M20.5 12 H17.8 M19 10.6 L17.6 12 L19 13.4" />
    </SvgIcon>
  )
}

// PC IconLockPdf
export function PdfToolsEncryptIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="4.5" y="4.5" width="7" height="15" rx="1" />
      <path d="M6.5 9 H9.5 M6.5 11.5 H9.5 M6.5 14 H8.5" />
      <rect x="13" y="13" width="7" height="6" rx="1" />
      <path d="M14.75 13 V11 A1.75 1.75 0 0 1 18.25 11 V13 M16.5 15.2 V16.8" />
    </SvgIcon>
  )
}

// PC IconUnlockPdf
export function PdfToolsDecryptIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="4.5" y="4.5" width="7" height="15" rx="1" />
      <path d="M6.5 9 H9.5 M6.5 11.5 H9.5 M6.5 14 H8.5" />
      <rect x="13" y="13" width="7" height="6" rx="1" />
      <path d="M14.75 13 V8.6 A1.75 1.75 0 0 1 18.25 8.6 V9.6 M16.5 15.2 V16.8" />
    </SvgIcon>
  )
}

// PC IconRepairPdf
export function PdfToolsRepairIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="6.5" y="4.5" width="11" height="15" rx="1" />
      <g transform="rotate(-40 12 12.5)">
        <rect x="7.75" y="10.7" width="8.5" height="3.6" rx="1.8" />
        <path d="M10.6 10.7 V14.3 M13.4 10.7 V14.3" />
      </g>
    </SvgIcon>
  )
}

// PC IconStripAnnots
export function PdfToolsStripAnnotsIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M4.5 5.5 H16.5 V13 H10 L6.8 15.6 V13 H4.5 Z" />
      <path d="M7.5 8.4 H13.5 M7.5 10.4 H11.5" />
      <path d="M15.2 15.7 L19.3 19.8 M19.3 15.7 L15.2 19.8" />
    </SvgIcon>
  )
}

// PC IconEditText (the PC tools window's "edit, sign" card uses it too)
export function PdfToolsEditIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M5 5.5 L14.5 5.5 M9.75 5.5 L9.75 15.5 M7.5 15.5 L12 15.5" />
      <path d="M16.7 10.3 L19.7 13.3 L13.4 19.6 L10.4 20.1 L10.9 17.1 Z" />
    </SvgIcon>
  )
}

/** The icon of each tools list card, by tool id. */
export const pdfToolsIcons: Readonly<Record<PdfToolsIconId, (props: IconProps) => ReactElement>> = {
  merge: PdfToolsMergeIcon,
  split: PdfToolsSplitIcon,
  extract: PdfToolsExtractIcon,
  reverse: PdfToolsReverseIcon,
  rotate: PdfToolsRotateIcon,
  blankPages: PdfToolsBlankPagesIcon,
  imagesToPdf: PdfToolsImagesToPdfIcon,
  toText: PdfToolsToTextIcon,
  compress: PdfToolsCompressIcon,
  encrypt: PdfToolsEncryptIcon,
  decrypt: PdfToolsDecryptIcon,
  repair: PdfToolsRepairIcon,
  stripAnnots: PdfToolsStripAnnotsIcon,
  edit: PdfToolsEditIcon,
}
