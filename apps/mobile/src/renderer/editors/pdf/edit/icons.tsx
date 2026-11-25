// Line icons of the PDF edit bar and its More-sheet entries (shared SvgIcon frame).
import { SvgIcon, type IconProps } from '../../../components/icons/svgIcon'

export function IconPdfPen(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M4 20l1.2-4.6L15.8 4.8a2 2 0 012.8 0l.6.6a2 2 0 010 2.8L8.6 18.8z" />
      <path d="M13.8 6.8l3.4 3.4" />
    </SvgIcon>
  )
}

export function IconPdfHighlighter(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M9 15l-2.5 2.5H3.5L6 15" />
      <path d="M9 15l-2-2 8.5-8.5a1.4 1.4 0 012 0l2 2a1.4 1.4 0 010 2L11 17z" />
      <path d="M12 20.5h8.5" />
    </SvgIcon>
  )
}

export function IconPdfTextBox(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M8.5 9h7M12 9v7" />
    </SvgIcon>
  )
}

export function IconPdfSign(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M3.5 16c2.5-1 4-5.5 5.5-9 .8-1.9 2.3-1.4 1.8.6-.8 3.3-2.6 7.6-1.2 8.1 1.3.5 2.7-3.2 4.2-3.1 1.1.1.5 2.2 1.6 2.3 1 .1 2-1 3.1-1.4" />
      <path d="M3.5 20.5h17" />
    </SvgIcon>
  )
}

export function IconPdfPages(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="3.5" y="3.5" width="7" height="8" rx="1" />
      <rect x="13.5" y="3.5" width="7" height="8" rx="1" />
      <rect x="3.5" y="14" width="7" height="6.5" rx="1" />
      <rect x="13.5" y="14" width="7" height="6.5" rx="1" />
    </SvgIcon>
  )
}

export function IconPdfLink(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />
    </SvgIcon>
  )
}
