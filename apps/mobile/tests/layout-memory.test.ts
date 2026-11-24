import { beforeEach, describe, expect, it } from 'vitest'
import { rememberedLayout, rememberLayout } from '../src/renderer/shell/layoutMemory'

describe('HWP layout memory', () => {
  beforeEach(() => window.localStorage.clear())

  it('remembers the layout chosen for each document', () => {
    expect(rememberedLayout(window.localStorage, 'a')).toBeNull()
    rememberLayout(window.localStorage, 'a', 'page')
    rememberLayout(window.localStorage, 'b', 'flow')
    rememberLayout(window.localStorage, 'a', 'flow')
    expect(rememberedLayout(window.localStorage, 'a')).toBe('flow')
    expect(rememberedLayout(window.localStorage, 'b')).toBe('flow')
  })

  it('keeps only the most recent documents', () => {
    for (let i = 0; i < 205; i += 1) rememberLayout(window.localStorage, `doc${i}`, 'page')
    expect(rememberedLayout(window.localStorage, 'doc0')).toBeNull()
    expect(rememberedLayout(window.localStorage, 'doc204')).toBe('page')
  })

  it('ignores damaged storage', () => {
    window.localStorage.setItem('ieum.mobile.hwpLayout', '{not json')
    expect(rememberedLayout(window.localStorage, 'a')).toBeNull()
    rememberLayout(window.localStorage, 'a', 'page')
    expect(rememberedLayout(window.localStorage, 'a')).toBe('page')
  })
})
