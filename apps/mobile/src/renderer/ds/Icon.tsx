import { SvgIcon, type IconProps as SvgIconProps } from '../components/icons/svgIcon'
import { ICON_SIZE, type IconSize } from './sizes'

export interface IconProps extends Omit<SvgIconProps, 'size'> {
  /** Size name, never a number (design system rule). Defaults to the bar size. */
  readonly size?: IconSize
}

/**
 * Line icon frame with a size name. Draws the same 24-unit grid as SvgIcon; the stroke
 * width stays the one SvgIcon sets unless a caller passes `strokeWidth`.
 */
export function Icon({ size = 'm', children, ...rest }: IconProps) {
  return (
    <SvgIcon size={ICON_SIZE[size]} {...rest}>
      {children}
    </SvgIcon>
  )
}
