// Line icons of the page organizer (shared SvgIcon frame).
import { SvgIcon, type IconProps } from '../../../../components/icons/svgIcon'

export function IconPagesRotate(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M20 11a8 8 0 10-2.3 5.7" />
      <path d="M20 4.5V11h-6.5" />
    </SvgIcon>
  )
}

export function IconPagesDelete(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V4.5h5V7" />
      <path d="M6.5 7l1 12.5h9l1-12.5" />
      <path d="M10.5 11v5M13.5 11v5" />
    </SvgIcon>
  )
}

export function IconPagesEarlier(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M14.5 6l-6 6 6 6" />
    </SvgIcon>
  )
}

export function IconPagesLater(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M9.5 6l6 6-6 6" />
    </SvgIcon>
  )
}

export function IconPagesBlankBefore(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="10" y="4" width="10" height="16" rx="1.5" />
      <path d="M3.5 12h4M5.5 10v4" />
    </SvgIcon>
  )
}

export function IconPagesBlankAfter(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="4" y="4" width="10" height="16" rx="1.5" />
      <path d="M16.5 12h4M18.5 10v4" />
    </SvgIcon>
  )
}

export function IconPagesImport(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M14 3.5H7a2 2 0 00-2 2v13a2 2 0 002 2h10a2 2 0 002-2V8.5z" />
      <path d="M14 3.5v5h5" />
      <path d="M12 11.5v6M9 14.5h6" />
    </SvgIcon>
  )
}

export function IconPagesGrip(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" strokeWidth={3} />
    </SvgIcon>
  )
}

export function IconPagesCheck(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </SvgIcon>
  )
}
