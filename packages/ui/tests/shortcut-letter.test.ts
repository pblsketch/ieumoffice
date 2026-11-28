import { describe, expect, it } from 'vitest'
import { isShortcutLetter, shortcutLetterOf } from '../src/shortcut-letter'

describe('shortcutLetterOf', () => {
  it('resolves ASCII letters directly and preserves non-QWERTY Latin layouts', () => {
    expect(shortcutLetterOf({ key: 'v', code: 'KeyV' })).toBe('v')
    expect(shortcutLetterOf({ key: 'V', code: 'KeyV' })).toBe('v')
    // Dvorak: 'o' sits on physical KeyS
    expect(shortcutLetterOf({ key: 'o', code: 'KeyS' })).toBe('o')
    expect(isShortcutLetter({ key: 'o', code: 'KeyS' }, 's')).toBe(false)
    expect(isShortcutLetter({ key: 'o', code: 'KeyS' }, 'o')).toBe(true)
  })

  it('resolves Korean IME and other non-Latin layouts via physical code', () => {
    // macOS Korean 2-beolsik reports Jamo with physical Key* code
    expect(shortcutLetterOf({ key: 'ㅍ', code: 'KeyV' })).toBe('v')
    expect(shortcutLetterOf({ key: 'ㅜ', code: 'KeyN' })).toBe('n')
    expect(shortcutLetterOf({ key: 'ㅅ', code: 'KeyT' })).toBe('t')
    expect(shortcutLetterOf({ key: 'ㄱ', code: 'KeyR' })).toBe('r')
    expect(shortcutLetterOf({ key: 'ㅣ', code: 'KeyL' })).toBe('l')
    expect(shortcutLetterOf({ key: 'ㅔ', code: 'KeyP' })).toBe('p')
    expect(shortcutLetterOf({ key: 'ㅗ', code: 'KeyH' })).toBe('h')
    expect(shortcutLetterOf({ key: 'ㄷ', code: 'KeyE' })).toBe('e')
    expect(shortcutLetterOf({ key: 'ㅋ', code: 'KeyZ' })).toBe('z')
    expect(shortcutLetterOf({ key: 'ㅛ', code: 'KeyY' })).toBe('y')
    // Windows Chromium Korean IME on non-editable targets reports key='Process', isComposing=false
    expect(shortcutLetterOf({ key: 'Process', code: 'KeyV', isComposing: false })).toBe('v')
    expect(shortcutLetterOf({ key: 'Process', code: 'KeyZ', isComposing: false })).toBe('z')
    // Cyrillic / Greek / Hebrew
    expect(shortcutLetterOf({ key: 'с', code: 'KeyC' })).toBe('c')
    expect(shortcutLetterOf({ key: 'σ', code: 'KeyS' })).toBe('s')
    expect(shortcutLetterOf({ key: 'ד', code: 'KeyD' })).toBe('d')
  })

  it('falls back to 2-beolsik Hangul Jamo mapping when code is omitted', () => {
    expect(shortcutLetterOf({ key: 'ㅍ' })).toBe('v')
    expect(shortcutLetterOf({ key: '쌍'.slice(0, 1) })).toBeNull()
    expect(shortcutLetterOf({ key: 'ㅃ' })).toBe('q')
    expect(shortcutLetterOf({ key: 'ㄸ' })).toBe('e')
    expect(shortcutLetterOf({ key: 'ㅋ' })).toBe('z')
  })

  it('returns null for AltGr, active IME composition, and non-letter keys', () => {
    expect(shortcutLetterOf({ key: 'ś', code: 'KeyS', altKey: true })).toBeNull()
    expect(shortcutLetterOf({ key: 'Process', code: 'KeyV', isComposing: true })).toBeNull()
    expect(shortcutLetterOf({ key: 'Enter', code: 'Enter' })).toBeNull()
    expect(shortcutLetterOf({ key: ' ', code: 'Space' })).toBeNull()
    expect(shortcutLetterOf({ key: '1', code: 'Digit1' })).toBeNull()
  })
})
