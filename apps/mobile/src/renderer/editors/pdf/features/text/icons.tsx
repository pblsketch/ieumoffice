// Line icons of the Text box tool's secondary bar (own folder, on the shared SvgIcon frame).
import { SvgIcon, type IconProps } from '../../../../components/icons/svgIcon'

export function IconTextBold(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7z" />
      <path d="M7 12h7a3.5 3.5 0 0 1 0 7H7z" />
    </SvgIcon>
  )
}

export function IconTextMinus(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M6 12h12" />
    </SvgIcon>
  )
}

export function IconTextPlus(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M12 6v12M6 12h12" />
    </SvgIcon>
  )
}

export function IconTextDelete(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </SvgIcon>
  )
}

export function IconTextConfirm(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </SvgIcon>
  )
}

export function IconTextBack(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M15 6l-6 6 6 6" />
    </SvgIcon>
  )
}
