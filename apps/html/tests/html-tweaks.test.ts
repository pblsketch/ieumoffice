import { describe, expect, it } from 'vitest'
import { applyPatches } from '../src/renderer/document/patch'
import {
  DEFAULT_HTML_TWEAKS,
  HTML_TWEAKS_PALETTES,
  applyHtmlTweaks,
  buildHtmlTweaksPatch,
  buildHtmlTweaksResetPatch,
} from '../src/renderer/tweaks/html-tweaks'

describe('HTML No-AI Style Tweaks', () => {
  it('ships 6 neutral palettes and applies/resets via single atomic Patch with 0 external URLs', () => {
    expect(HTML_TWEAKS_PALETTES).toHaveLength(6)
    const base =
      '<!DOCTYPE html><html><head><title>Doc</title></head><body><h1>Hi</h1></body></html>'

    const patch = buildHtmlTweaksPatch(base, {
      ...DEFAULT_HTML_TWEAKS,
      palette: 'navy',
      accent: '#1e3a5f',
      fontScalePct: 115,
      lineHeight: 1.75,
      density: 'relaxed',
      radius: 'rounded',
    })
    const tweaked = applyPatches(base, [patch])
    expect(tweaked).toContain('<style id="ieum-tweaks">')
    expect(tweaked).toContain('font-size: 115%')
    expect(tweaked).toContain('line-height: 1.75')
    expect(tweaked).not.toMatch(/https?:\/\//i)

    // Updating replaces existing managed style tag instead of duplicating
    const updated = applyHtmlTweaks(tweaked, { ...DEFAULT_HTML_TWEAKS, palette: 'forest' })
    expect(updated.match(/id="ieum-tweaks"/g)).toHaveLength(1)

    // Single reset patch restores exact baseline
    const reset = applyPatches(updated, [buildHtmlTweaksResetPatch(updated, base)])
    expect(reset).toBe(base)
  })
})
