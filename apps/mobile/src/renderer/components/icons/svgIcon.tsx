// Owned by S0 (change only with approval): the line icon frame every track's icons use.
// A leaf file — it imports nothing from this folder — so track icon files can import it safely.
import type { SVGProps } from 'react'

export type IconProps = SVGProps<SVGSVGElement> & { readonly size?: number }

export function SvgIcon({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.85}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}
