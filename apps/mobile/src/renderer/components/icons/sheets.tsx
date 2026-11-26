// Icons of track T1 sheets. Draw them with SvgIcon from './svgIcon' (not from MobileIcons, which
// imports this folder's index). File-type pictures go in the map below.
import fileXlsxSvg from '../../editors/sheets/assets/file-xlsx.svg'
import { SvgIcon, type IconProps } from './svgIcon'
import type { DocTypeIconMap } from './types'

/**
 * The spreadsheet file picture (the desktop's file-xlsx.svg, made by
 * tools/gen-file-association-icons.mjs); like the desktop, .xlsm, .xls and
 * .csv share it.
 */
export const sheetsDocTypeIcons: DocTypeIconMap = {
  xlsx: fileXlsxSvg,
  xlsm: fileXlsxSvg,
  xls: fileXlsxSvg,
  csv: fileXlsxSvg,
}

/** Grid with its top row held (freeze top row). */
export function IconFreezeRow(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="M3.5 9h17" strokeWidth={2.6} />
      <path d="M9.5 9v11.5M15 9v11.5M3.5 14.5h17" />
    </SvgIcon>
  )
}

/** Grid with its first column held (freeze first column). */
export function IconFreezeColumn(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="M9 3.5v17" strokeWidth={2.6} />
      <path d="M9 9.5h11.5M9 15h11.5M14.5 3.5v17" />
    </SvgIcon>
  )
}

/** Plain grid (no frozen panes). */
export function IconUnfreeze(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="M3.5 9.5h17M3.5 15h17M9.5 3.5v17M15 3.5v17" />
    </SvgIcon>
  )
}

/** Edit toolbar [셀 서식]: a letter over a cell's fill line. */
export function IconCellFormat(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M5.5 15 10 4h1l4.5 11" />
      <path d="M7.2 11h6.6" />
      <path d="M4 19.5h16" strokeWidth={2.6} />
    </SvgIcon>
  )
}

/** Edit toolbar [행·열]: a row and a column with a plus. */
export function IconRowsColumns(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="3.5" y="3.5" width="12" height="12" rx="1.5" />
      <path d="M3.5 9.5h12M9.5 3.5v12" />
      <path d="M18.5 15v6M15.5 18h6" />
    </SvgIcon>
  )
}

/** Edit toolbar [정렬·필터]: a funnel beside sort arrows. */
export function IconSortFilter(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M3.5 5h10l-3.8 5v6l-2.4 1.5V10z" />
      <path d="M18 4v15M15 16l3 3 3-3" />
    </SvgIcon>
  )
}

/** Edit toolbar [삽입]: a box with a plus. */
export function IconInsertCells(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="M12 8v8M8 12h8" />
    </SvgIcon>
  )
}

/** Find (and replace) in the workbook. */
export function IconFindCells(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5" />
    </SvgIcon>
  )
}

/** A row that opens a list (picker rows of the format sheet). */
export function IconChevronNext(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="m9.5 6 6 6-6 6" />
    </SvgIcon>
  )
}

/** Back from a list to its sheet. */
export function IconChevronPrevious(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="m14.5 6-6 6 6 6" />
    </SvgIcon>
  )
}
