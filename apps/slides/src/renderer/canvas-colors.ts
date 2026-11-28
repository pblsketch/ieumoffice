/**
 * Konva-drawn editing chrome colours. The redact frame rides into thumbnails
 * over the picture it marks, so it is drawn the same in both UI themes.
 */
export const CANVAS_COLORS = {
  redactFrame: {
    stroke: 'rgba(0,0,0,0.55)',
    chip: 'rgba(0,0,0,0.55)',
    label: '#ffffff',
  },
} as const

/**
 * The mark over what the AI panel's last run changed. It follows the UI theme
 * because it is screen-only: it sits on the edit canvas, never on thumbnails,
 * exports, prints or the slide show. Read from the shared tokens when drawn.
 */
export function aiChangedMarkColors(): { fill: string; stroke: string } {
  const style = getComputedStyle(document.documentElement)
  return {
    fill: style.getPropertyValue('--color-ai-changed-bg').trim(),
    stroke: style.getPropertyValue('--color-ai-changed-line').trim(),
  }
}

/**
 * Multi-cell table selection tint and outline on the edit canvas (screen-only, follows the UI theme).
 */
export function tableCellSelectionColors(): { fill: string; stroke: string } {
  const style = getComputedStyle(document.documentElement)
  return {
    fill: style.getPropertyValue('--slides-table-sel-fill').trim() || 'rgba(196, 62, 28, 0.16)',
    stroke: style.getPropertyValue('--slides-table-sel-stroke').trim() || '#c43e1c',
  }
}
