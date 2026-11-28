import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('whiteboard autosave and hook dependency wiring', () => {
  it('passes the stable window.whiteboardApi.core reference to useAutoSavePref', () => {
    const app = readFileSync(resolve(__dirname, '../src/renderer/App.tsx'), 'utf8')
    expect(app).toMatch(
      /useAutoSavePref\(\s*'whiteboardapp\.autoSave',\s*window\.whiteboardApi\??\.core,?\s*\)/,
    )
  })

  it('never puts useI18n() t in React hook dependency arrays', () => {
    for (const rel of [
      '../src/renderer/App.tsx',
      '../src/renderer/components/WhiteboardEditor.tsx',
    ]) {
      const src = readFileSync(resolve(__dirname, rel), 'utf8')
      expect(src, rel).not.toMatch(/\[\s*(?:[^[\]]*,\s*)?t\s*(?:,[^[\]]*)?\]/)
    }
  })
})
