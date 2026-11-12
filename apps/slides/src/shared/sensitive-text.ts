/**
 * The deck's text as "find sensitive info" reads it: every text body on every
 * slide in reading order (shapes, group children, table cells), each paragraph
 * as its model runs, each slide's speaker notes
 * and its review comments. The renderer finds the
 * candidates and hides a confirmed one with the ordinary text ops, so the runs
 * carry what those ops need: their text, the mark they already have, and
 * whether they are the kind a split would damage.
 */

export interface SensitiveRunInfo {
  text: string
  /** the hiding label the run already has */
  redact?: string
  /**
   * A run the text ops must not split: a field (slide number, date), a
   * verbatim block such as an equation, the soft-break sentinel or the empty
   * paragraph mark. A candidate touching one cannot be hidden.
   */
  fixed?: true
}

export interface SensitiveBodyInfo {
  slide: number
  /** the element id the ops address */
  el: string
  /** the group the element sits directly in */
  group?: string
  /** a body the text ops cannot reach (a group inside a group, a table inside a group) */
  unreachable?: true
  /** a table cell, in model coordinates */
  cell?: { row: number; col: number }
  /** the text of the table's first row in this cell's column, for a cell below it */
  header?: string
  paragraphs: SensitiveRunInfo[][]
}

export interface SlidesSensitiveText {
  bodies: SensitiveBodyInfo[]
  /** speaker notes per slide, '' when there are none */
  notes: string[]
  /** review comments per slide (the AI reads them; they hold no mark) */
  comments: string[][]
}

export interface SensitiveExclusionEntryIpc {
  kind: string
  hash: string
}
