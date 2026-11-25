/**
 * Keyboard shortcut matchers for the Whiteboard canvas editor.
 * Resolves tool keys (V/N/T/R/L/P/H/E) and history chords (Ctrl/Cmd+Z/Y)
 * across Latin and non-Latin keyboard layouts (including Korean IME), and
 * recognises Space-hold temporary hand-pan mode.
 */
import { shortcutLetterOf, type ShortcutLetterEvent } from '@genoffice/ui'

export type WhiteboardToolKind =
  'select' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'highlighter' | 'eraser'

export interface WhiteboardKeyEvent extends ShortcutLetterEvent {
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  repeat?: boolean | undefined
}

const TOOL_BY_LETTER: Readonly<Record<string, WhiteboardToolKind>> = {
  v: 'select',
  n: 'sticky',
  t: 'text',
  r: 'shape',
  l: 'connector',
  p: 'pen',
  h: 'highlighter',
  e: 'eraser',
}

/** Single-key tool shortcut (V/N/T/R/L/P/H/E), or null when modifiers are held. */
export function whiteboardToolShortcut(event: WhiteboardKeyEvent): WhiteboardToolKind | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  const letter = shortcutLetterOf(event)
  return letter ? (TOOL_BY_LETTER[letter] ?? null) : null
}

/** Undo/Redo chord (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl/Cmd+Y), or null. */
export function whiteboardHistoryShortcut(event: WhiteboardKeyEvent): 'undo' | 'redo' | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null
  const letter = shortcutLetterOf(event)
  if (letter === 'z') return event.shiftKey ? 'redo' : 'undo'
  if (letter === 'y' && !event.shiftKey) return 'redo'
  return null
}

/** True when a plain Space keydown/keyup toggles temporary hand-pan mode. */
export function isSpacePanKey(event: WhiteboardKeyEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  return event.code === 'Space' || event.key === ' '
}
