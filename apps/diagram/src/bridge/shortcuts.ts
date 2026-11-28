/** The app's shortcuts that win over draw.io's while draw.io has the keyboard (spec 4). */

export interface KeyLike {
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  isComposing?: boolean
}

const JAMO_LETTER: Readonly<Record<string, string>> = {
  ㄴ: 's',
  ㅔ: 'p',
  ㅖ: 'p',
}

function shortcutLetter(event: KeyLike): string {
  const key = event.key.toLowerCase()
  if (/^[a-z]$/.test(key)) return key
  if (event.altKey || event.isComposing) return ''
  const match = /^Key([A-Z])$/.exec(event.code ?? '')
  if (match) return match[1]!.toLowerCase()
  return JAMO_LETTER[event.key] ?? ''
}

/** `save` for Ctrl+S, `saveAs` for Ctrl+Shift+S, `print` for Ctrl+P (Cmd on macOS); null for the rest. */
export function isAppShortcut(event: KeyLike): 'save' | 'saveAs' | 'print' | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null
  const key = shortcutLetter(event)
  if (key === 's') return event.shiftKey ? 'saveAs' : 'save'
  if (key === 'p' && !event.shiftKey) return 'print'
  return null
}

/** F1 with no modifier: the app's help, as draw.io's Help menu item. */
export function isHelpKey(event: KeyLike): boolean {
  return event.key === 'F1' && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
}
