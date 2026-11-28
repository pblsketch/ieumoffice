// Line icons of the [Pen] sheet tools (shared SvgIcon frame).
import { SvgIcon, type IconProps } from '../../../../components/icons/svgIcon'

export function IconDrawInk(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M3.5 17c2-3.5 4-6 6-6 2.5 0 1.5 5 4 5 2 0 3.5-4 7-6.5" />
    </SvgIcon>
  )
}

export function IconDrawRect(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="4" y="6" width="16" height="12" rx="1" />
    </SvgIcon>
  )
}

export function IconDrawEllipse(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <ellipse cx="12" cy="12" rx="8.5" ry="6.5" />
    </SvgIcon>
  )
}

export function IconDrawLine(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M5 19L19 5" />
    </SvgIcon>
  )
}

export function IconDrawArrow(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M5 19L19 5" />
      <path d="M11 5h8v8" />
    </SvgIcon>
  )
}

export function IconDrawEraser(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M8.5 19.5L3.9 14.9a1.5 1.5 0 010-2.1l8.4-8.4a1.5 1.5 0 012.1 0l5.2 5.2a1.5 1.5 0 010 2.1L12 19.5z" />
      <path d="M8.5 9l6.5 6.5" />
      <path d="M12 19.5h8" />
    </SvgIcon>
  )
}
