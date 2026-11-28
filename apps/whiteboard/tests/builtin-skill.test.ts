// The built-in `whiteboard` skill (apps/shell/resources/builtin-skills) names
// tools, ops, page formats, shapes, stickers, palette colors and a JSON example
// for apply_template. These tests keep the skill's words true to the editor
// and verify that its example renders cleanly without overlap.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyTemplate,
  createNewBoard,
  type BoardObject,
  type ConnectorProps,
  type PageFormat,
} from '@genoffice/whiteboard-engine'
import { ensureWhiteboardEngineSync } from '@genoffice/whiteboard-engine/node'
import { WHITEBOARD_TOOL_NAMES } from '../src/renderer/ai/whiteboard-tools'
import {
  PAPER_COLORS,
  PAPER_FILL_SWATCHES,
  PAPER_INK_SWATCHES,
  SHAPE_STYLE_PRESETS,
} from '../src/renderer/canvas/paper-style'
import { SHAPE_KINDS } from '../src/renderer/canvas/shape-paths'
import { STICKER_IDS } from '../src/renderer/canvas/stickers'

const SKILL = readFileSync(
  join(__dirname, '../../shell/resources/builtin-skills/whiteboard/SKILL.md'),
  'utf8',
)

const PROSE = SKILL.replace(/```[\s\S]*?```/g, '')

const EDIT_OPS = [
  'add',
  'update',
  'move',
  'delete',
  'add_page',
  'rename_page',
  'delete_page',
  'set_page_format',
] as const

const PAGE_FORMATS: readonly PageFormat[] = [
  'freeform',
  'wide_16_9',
  'a4_portrait',
  'a4_landscape',
  'custom',
]

const TEMPLATE_TARGETS = ['current_page', 'new_pages'] as const

/** `words_like_this` in backticks outside code fences: tools, ops, formats, shapes, targets */
const named = (text: string) => [...text.matchAll(/`([a-z0-9]+(?:_[a-z0-9]+)+)`/g)].map((m) => m[1])

function rectsOverlap(a: BoardObject, b: BoardObject, minGap: number): boolean {
  return (
    a.x < b.x + b.width + minGap &&
    a.x + a.width + minGap > b.x &&
    a.y < b.y + b.height + minGap &&
    a.y + a.height + minGap > b.y
  )
}

function isZoneShape(o: BoardObject): boolean {
  return o.kind === 'shape' && (o.props as { lineStyle?: string }).lineStyle === 'dashed'
}

describe('the built-in whiteboard skill', () => {
  it('is scoped to the whiteboard editor with a required check section', () => {
    expect(SKILL).toMatch(/^---\nname: whiteboard\n/)
    expect(SKILL).toMatch(/\nmetadata:\n {2}ieum-editors: whiteboard\n---\n/)
    expect(SKILL).toMatch(/\n## \d\. Check before you answer \(required\)\n/)
    expect(SKILL).toContain(
      'In another window, do the same steps with the tools that window gives you.',
    )
  })

  it('names only tools, ops, page formats, shapes and template targets this editor has', () => {
    const known = new Set<string>([
      ...Object.values(WHITEBOARD_TOOL_NAMES),
      ...EDIT_OPS,
      ...PAGE_FORMATS,
      ...SHAPE_KINDS,
      ...TEMPLATE_TARGETS,
    ])
    const words = named(PROSE)
    expect(words).toEqual(
      expect.arrayContaining([
        'read_board',
        'edit_board',
        'apply_template',
        'search_images',
        'insert_image',
        'generate_image',
        'add_page',
        'rename_page',
        'delete_page',
        'set_page_format',
        'wide_16_9',
        'a4_portrait',
        'a4_landscape',
        'current_page',
        'rounded_rectangle',
        'speech_bubble',
        'block_arrow',
      ]),
    )
    for (const word of words) {
      expect(known.has(word), word).toBe(true)
    }
  })

  it('lists every built-in shape kind and sticker id accurately', () => {
    const shapeLine = PROSE.split('\n').find((l) => l.startsWith('- **Shapes ('))!
    const shapes = new Set([...shapeLine.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]))
    expect([...shapes].sort()).toEqual([...SHAPE_KINDS].sort())

    const stickerLine = PROSE.split('\n').find((l) => l.startsWith('- **Stickers:**'))!
    const stickers = new Set([...stickerLine.matchAll(/`([a-z]+)`/g)].map((m) => m[1]))
    expect([...stickers].sort()).toEqual([...STICKER_IDS].sort())
  })

  it('uses only palette colors that belong to the editor swatches', () => {
    const allowed = new Set<string>(
      [
        ...PAPER_FILL_SWATCHES,
        ...PAPER_INK_SWATCHES,
        ...Object.values(PAPER_COLORS),
        ...SHAPE_STYLE_PRESETS.flatMap((p) => [p.fill, p.stroke]),
      ]
        .filter((c) => c.startsWith('#'))
        .map((c) => c.toUpperCase()),
    )
    const hexes = [...SKILL.matchAll(/#[0-9A-Fa-f]{6}/g)].map((m) => m[0].toUpperCase())
    expect(hexes.length).toBeGreaterThanOrEqual(8)
    for (const hex of hexes) {
      expect(allowed.has(hex), hex).toBe(true)
    }
  })

  it('shows an apply_template JSON example that applies cleanly with no overlaps and valid edge anchors', () => {
    ensureWhiteboardEngineSync()
    const match = /```json\n([\s\S]*?)\n```/.exec(SKILL)
    expect(match).not.toBeNull()
    const template = JSON.parse(match![1]!) as Record<string, unknown>

    const blank = createNewBoard('b1', 'p1', '')
    const applied = applyTemplate(blank, template, 'p1')
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const res = applied.result
    expect(res.createdPageIds).toHaveLength(0)
    expect(res.doc.pages).toHaveLength(1)

    const page = res.doc.pages[0]!
    expect(page.format).toBe('wide_16_9')
    expect(page.width).toBe(1920)
    expect(page.height).toBe(1080)

    const objects = res.doc.objects
    const objById = new Map(objects.map((o) => [o.id, o]))
    expect(objects.length).toBeGreaterThanOrEqual(10)

    // Every non-connector object stays inside the fixed 16:9 page with outer margin.
    for (const o of objects) {
      if (o.kind === 'connector') continue
      expect(o.x, o.id).toBeGreaterThanOrEqual(24)
      expect(o.y, o.id).toBeGreaterThanOrEqual(24)
      expect(o.x + o.width, o.id).toBeLessThanOrEqual(page.width - 24)
      expect(o.y + o.height, o.id).toBeLessThanOrEqual(page.height - 24)
    }

    // Zones do not carry hidden centered text behind children, and do not overlap each other.
    const zones = objects.filter(isZoneShape)
    expect(zones.length).toBe(3)
    for (const z of zones) {
      const paragraphs = (z.props as { text?: { paragraphs?: { runs?: { text?: string }[] }[] } })
        .text?.paragraphs
      const plain = (paragraphs ?? [])
        .flatMap((p) => p.runs ?? [])
        .map((r) => r.text ?? '')
        .join('')
        .trim()
      expect(plain, z.id).toBe('')
    }
    for (let i = 0; i < zones.length; i += 1) {
      for (let j = i + 1; j < zones.length; j += 1) {
        expect(rectsOverlap(zones[i]!, zones[j]!, 24), `${zones[i]!.id} vs ${zones[j]!.id}`).toBe(
          false,
        )
      }
    }

    // Non-zone content objects never overlap each other (min 20 px gap).
    const items = objects.filter((o) => o.kind !== 'connector' && !isZoneShape(o))
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        expect(rectsOverlap(items[i]!, items[j]!, 20), `${items[i]!.id} vs ${items[j]!.id}`).toBe(
          false,
        )
      }
    }

    // Every connector references valid objects and uses explicit side anchors (not center 0.5, 0.5).
    const connectors = objects.filter((o) => o.kind === 'connector')
    expect(connectors.length).toBeGreaterThanOrEqual(1)
    for (const c of connectors) {
      const p = c.props as unknown as ConnectorProps
      expect('objectId' in p.start && objById.has(p.start.objectId)).toBe(true)
      expect('objectId' in p.end && objById.has(p.end.objectId)).toBe(true)
      if ('objectId' in p.start) {
        expect(p.start.anchorX === 0.5 && p.start.anchorY === 0.5).toBe(false)
      }
      if ('objectId' in p.end) {
        expect(p.end.anchorX === 0.5 && p.end.anchorY === 0.5).toBe(false)
      }
    }
  })

  it('stays compact enough to ride cleanly in a skill turn', () => {
    expect(SKILL.length).toBeLessThan(9500)
  })
})
