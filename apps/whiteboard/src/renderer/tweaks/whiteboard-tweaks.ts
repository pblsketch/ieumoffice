/**
 * No-AI live style Tweaks engine for Whiteboard (T14).
 * Applies background tone, neutral palette, text scale, corner radius, and
 * stroke width across the board via `WhiteboardSession.commitDocument` as a
 * single undoable step. Zero AI calls, zero external CDNs.
 */
import type { BoardDocument } from '@genoffice/whiteboard-engine'
import type { WhiteboardSession } from '../document/session'

export type WhiteboardBgTone = 'white' | 'paper' | 'dot-grid' | 'square-grid'
export type WhiteboardPaletteId =
  'default' | 'editorial' | 'navy' | 'forest' | 'slate' | 'warm-sand'
export type WhiteboardRadius = 'sharp' | 'normal' | 'rounded'

export interface WhiteboardTweaksPalette {
  readonly id: WhiteboardPaletteId
  readonly fill: string
  readonly stroke: string
  readonly text: string
}

export const WHITEBOARD_TWEAKS_PALETTES: readonly WhiteboardTweaksPalette[] = [
  { id: 'default', fill: '#FFFFFF', stroke: '#1E293B', text: '#0F172A' },
  { id: 'editorial', fill: '#FAF7F0', stroke: '#7C2D12', text: '#1F1D1A' },
  { id: 'navy', fill: '#F1F5F9', stroke: '#1E3A5F', text: '#0F172A' },
  { id: 'forest', fill: '#F1F6F2', stroke: '#1F6F4A', text: '#14261C' },
  { id: 'slate', fill: '#F4F4F5', stroke: '#3F3F46', text: '#18181B' },
  { id: 'warm-sand', fill: '#F6EFE4', stroke: '#92400E', text: '#292118' },
]

export interface WhiteboardTweaksState {
  background: WhiteboardBgTone
  palette: WhiteboardPaletteId
  /** 85..125 percent */
  fontScalePct: number
  radius: WhiteboardRadius
  /** 1..4 px */
  strokeWidth: number
}

export const DEFAULT_WHITEBOARD_TWEAKS: WhiteboardTweaksState = {
  background: 'white',
  palette: 'default',
  fontScalePct: 100,
  radius: 'normal',
  strokeWidth: 2,
}

function backgroundForTone(tone: WhiteboardBgTone): Record<string, unknown> {
  switch (tone) {
    case 'paper':
      return { kind: 'solid', color: '#FAF8F3' }
    case 'dot-grid':
      return { kind: 'dots', color: '#FFFFFF' }
    case 'square-grid':
      return { kind: 'grid', color: '#FFFFFF' }
    default:
      return { kind: 'solid', color: '#FFFFFF' }
  }
}

function cornerRadiusFor(radius: WhiteboardRadius): number {
  switch (radius) {
    case 'sharp':
      return 0
    case 'rounded':
      return 16
    default:
      return 8
  }
}

export function applyWhiteboardTweaksToDocument(
  doc: BoardDocument,
  state: WhiteboardTweaksState,
): BoardDocument {
  const next = structuredClone(doc)
  const pal =
    WHITEBOARD_TWEAKS_PALETTES.find((p) => p.id === state.palette) ?? WHITEBOARD_TWEAKS_PALETTES[0]!
  const bg = backgroundForTone(state.background)
  const scale = Math.min(125, Math.max(85, state.fontScalePct)) / 100
  const cornerRadius = cornerRadiusFor(state.radius)
  const strokeWidth = Math.min(4, Math.max(1, Math.round(state.strokeWidth)))

  for (const page of next.pages) {
    const p = page as unknown as Record<string, unknown>
    // Preserve imported PDF image backgrounds
    if (p.background && (p.background as Record<string, unknown>).kind === 'image') continue
    p.background = bg
  }

  for (const obj of next.objects) {
    const o = obj as unknown as Record<string, unknown>
    if (typeof o.stroke === 'string') o.stroke = pal.stroke
    if (typeof o.fill === 'string' && o.fill !== 'transparent' && o.fill !== 'none') {
      o.fill = pal.fill
    }
    if (typeof o.textColor === 'string') o.textColor = pal.text
    if (typeof o.strokeWidth === 'number') o.strokeWidth = strokeWidth
    if (typeof o.cornerRadius === 'number') o.cornerRadius = cornerRadius
    if (typeof o.fontSize === 'number' && state.fontScalePct !== 100) {
      o.fontSize = Math.max(10, Math.round(o.fontSize * scale))
    }
  }

  return next
}

export function commitWhiteboardTweaks(
  session: WhiteboardSession,
  baselineDoc: BoardDocument,
  state: WhiteboardTweaksState,
): void {
  const tweaked = applyWhiteboardTweaksToDocument(baselineDoc, state)
  session.commitDocument(tweaked)
}

export function resetWhiteboardTweaks(
  session: WhiteboardSession,
  baselineDoc: BoardDocument,
): void {
  session.commitDocument(structuredClone(baselineDoc))
}
