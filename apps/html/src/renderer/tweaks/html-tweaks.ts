/**
 * No-AI live style tweaks engine for HTML documents (T14).
 * Patches a managed `<style id="ieum-tweaks">` block inside `<head>` via a
 * single atomic `Patch` so Ctrl+Z undoes any adjustment or Reset in one step.
 * Zero AI calls, zero external CDNs, neutral preset names only.
 */
import type { Patch } from '../document/patch'
import { applyPatches } from '../document/patch'

export type HtmlTweaksPaletteId =
  'default' | 'editorial' | 'navy' | 'forest' | 'slate' | 'warm-sand'

export type HtmlTweaksDensity = 'compact' | 'normal' | 'relaxed'
export type HtmlTweaksRadius = 'sharp' | 'normal' | 'rounded'

export interface HtmlTweaksPalette {
  readonly id: HtmlTweaksPaletteId
  readonly bg: string
  readonly surface: string
  readonly text: string
  readonly muted: string
  readonly accent: string
  readonly border: string
}

export const HTML_TWEAKS_PALETTES: readonly HtmlTweaksPalette[] = [
  {
    id: 'default',
    bg: '#ffffff',
    surface: '#f8fafc',
    text: '#18181b',
    muted: '#52525b',
    accent: '#2563eb',
    border: '#d4d4d8',
  },
  {
    id: 'editorial',
    bg: '#fbfaf7',
    surface: '#f3f0e8',
    text: '#1f1d1a',
    muted: '#5c574f',
    accent: '#9a3412',
    border: '#ddd6c7',
  },
  {
    id: 'navy',
    bg: '#ffffff',
    surface: '#f1f5f9',
    text: '#0f172a',
    muted: '#475569',
    accent: '#1e3a5f',
    border: '#cbd5e1',
  },
  {
    id: 'forest',
    bg: '#fcfdfb',
    surface: '#f1f6f2',
    text: '#14261c',
    muted: '#466151',
    accent: '#1f6f4a',
    border: '#cfe0d5',
  },
  {
    id: 'slate',
    bg: '#ffffff',
    surface: '#f4f4f5',
    text: '#18181b',
    muted: '#52525b',
    accent: '#3f3f46',
    border: '#d4d4d8',
  },
  {
    id: 'warm-sand',
    bg: '#fdfbf7',
    surface: '#f6efe4',
    text: '#292118',
    muted: '#6b5b49',
    accent: '#b45309',
    border: '#e5d8c3',
  },
]

export interface HtmlTweaksState {
  palette: HtmlTweaksPaletteId
  accent: string
  /** 85..125 percent */
  fontScalePct: number
  /** 1.35..1.85 */
  lineHeight: number
  density: HtmlTweaksDensity
  radius: HtmlTweaksRadius
}

export const DEFAULT_HTML_TWEAKS: HtmlTweaksState = {
  palette: 'default',
  accent: '#2563eb',
  fontScalePct: 100,
  lineHeight: 1.6,
  density: 'normal',
  radius: 'normal',
}

const STYLE_TAG_RE = /<style\s+id=["']ieum-tweaks["'][^>]*>[\s\S]*?<\/style>/i

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function paddingFor(density: HtmlTweaksDensity): string {
  switch (density) {
    case 'compact':
      return '16px 20px'
    case 'relaxed':
      return '40px 44px'
    default:
      return '28px 32px'
  }
}

function radiusFor(radius: HtmlTweaksRadius): string {
  switch (radius) {
    case 'sharp':
      return '0px'
    case 'rounded':
      return '12px'
    default:
      return '6px'
  }
}

export function buildHtmlTweaksStyleTag(state: HtmlTweaksState): string {
  const pal = HTML_TWEAKS_PALETTES.find((p) => p.id === state.palette) ?? HTML_TWEAKS_PALETTES[0]!
  const accent = /^#[0-9a-fA-F]{6}$/.test(state.accent) ? state.accent : pal.accent
  const fontScale = clamp(Math.round(state.fontScalePct), 85, 125)
  const lineHeight = Number(clamp(state.lineHeight, 1.35, 1.85).toFixed(2))
  const pad = paddingFor(state.density)
  const rad = radiusFor(state.radius)

  return `<style id="ieum-tweaks">
:root {
  --tweak-bg: ${pal.bg};
  --tweak-surface: ${pal.surface};
  --tweak-text: ${pal.text};
  --tweak-muted: ${pal.muted};
  --tweak-accent: ${accent};
  --tweak-border: ${pal.border};
  --tweak-radius: ${rad};
}
html { font-size: ${fontScale}%; }
body {
  background-color: var(--tweak-bg);
  color: var(--tweak-text);
  line-height: ${lineHeight};
  padding: ${pad};
}
h1, h2, h3, a { color: var(--tweak-accent); }
table, th, td, .kpi, .card, .callout { border-color: var(--tweak-border); border-radius: var(--tweak-radius); }
th, .kpi, .card, .callout { background-color: var(--tweak-surface); }
</style>`
}

/** Computes a single atomic `Patch` that installs or updates `<style id="ieum-tweaks">`. */
export function buildHtmlTweaksPatch(html: string, state: HtmlTweaksState): Patch {
  const tag = buildHtmlTweaksStyleTag(state)
  const existing = STYLE_TAG_RE.exec(html)
  if (existing) {
    return {
      from: existing.index,
      to: existing.index + existing[0].length,
      text: tag,
    }
  }
  const headClose = html.search(/<\/head>/i)
  if (headClose >= 0) {
    return { from: headClose, to: headClose, text: `${tag}\n` }
  }
  return { from: 0, to: 0, text: `${tag}\n` }
}

/** Computes a single atomic `Patch` restoring the exact baseline HTML captured when Tweaks opened. */
export function buildHtmlTweaksResetPatch(currentHtml: string, baselineHtml: string): Patch {
  return { from: 0, to: currentHtml.length, text: baselineHtml }
}

export function applyHtmlTweaks(html: string, state: HtmlTweaksState): string {
  return applyPatches(html, [buildHtmlTweaksPatch(html, state)])
}
