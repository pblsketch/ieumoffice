// Line icons of the form feature: the check and cross marks (More-sheet rows, check boxes).
import { SvgIcon, type IconProps } from '../../../../components/icons/svgIcon'

export function IconFormCheck(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M4.5 12.5l4.6 4.5L19.5 6.5" />
    </SvgIcon>
  )
}

export function IconFormCross(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </SvgIcon>
  )
}
