// Line icons of the PDF viewer (drawn with the shared SvgIcon frame).
import { SvgIcon, type IconProps } from '../../../components/icons/svgIcon'

export function IconPdfSearch(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </SvgIcon>
  )
}

export function IconPdfOutline(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M4 6h3M10 6h10M6 12h3M12 12h8M6 18h3M12 18h8" />
    </SvgIcon>
  )
}

export function IconPdfGoToPage(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M7 3.5h7l4 4V20.5H7z" />
      <path d="M14 3.5v4h4" />
      <path d="M10 14h5M13 11.5l2.5 2.5-2.5 2.5" />
    </SvgIcon>
  )
}

export function IconPdfChevronUp(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M6 15l6-6 6 6" />
    </SvgIcon>
  )
}

export function IconPdfChevronDown(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M6 9l6 6 6-6" />
    </SvgIcon>
  )
}

export function IconPdfEye(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </SvgIcon>
  )
}

export function IconPdfEyeOff(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M4 4l16 16" />
      <path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.7M6.4 7.4A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5a9.3 9.3 0 0 0 4.2-1" />
      <path d="M10 10.2a2.8 2.8 0 0 0 3.9 3.9" />
    </SvgIcon>
  )
}

export function IconPdfLock(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" />
    </SvgIcon>
  )
}
