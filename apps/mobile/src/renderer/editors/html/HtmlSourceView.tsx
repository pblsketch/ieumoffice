export interface HtmlSourceViewProps {
  readonly value: string
  /** true: the source is shown for reading only (view mode, or a document that cannot be edited). */
  readonly readOnly: boolean
  readonly label: string
  /** The whole new source after a keystroke, paste or cut (one whole-source replace). */
  readonly onChange: (next: string) => void
}

/** The whole HTML source in a text box (spec 5.3). */
export function HtmlSourceView({ value, readOnly, label, onChange }: HtmlSourceViewProps) {
  return (
    <textarea
      className="web-html-source"
      value={value}
      readOnly={readOnly}
      onChange={readOnly ? undefined : (event) => onChange(event.target.value)}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      aria-label={label}
      data-testid="web-html-source"
    />
  )
}
