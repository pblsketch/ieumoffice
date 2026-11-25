// Tool icons of the annotation feature (line icons on the shared SvgIcon frame).
import { SvgIcon, type IconProps } from '../../../../components/icons/svgIcon'

export function IconAnnotUnderline(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M7 4v6a5 5 0 0 0 10 0V4" />
      <path d="M5 20h14" />
    </SvgIcon>
  )
}

export function IconAnnotSquiggly(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M7 4v5a5 5 0 0 0 10 0V4" />
      <path d="M3 19.5c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0" />
    </SvgIcon>
  )
}

export function IconAnnotStrikeout(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M16.5 6.5C15.6 5 14 4 12 4c-2.8 0-4.5 1.6-4.5 3.6 0 1.5 1 2.6 3 3.4" />
      <path d="M8 17.5c.9 1.5 2.5 2.5 4.5 2.5 2.8 0 4.5-1.6 4.5-3.7 0-.9-.3-1.7-1-2.3" />
      <path d="M4 12h16" />
    </SvgIcon>
  )
}

export function IconAnnotNote(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M4 5h16v11h-8l-4 3.5V16H4z" />
      <path d="M8 9.5h8M8 12.5h5" />
    </SvgIcon>
  )
}

export function IconAnnotSelectText(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M5 6h9M5 10h14M5 14h8" />
      <path d="M16 13v7M14 13h4M14 20h4" />
    </SvgIcon>
  )
}

export function IconAnnotClose(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </SvgIcon>
  )
}
