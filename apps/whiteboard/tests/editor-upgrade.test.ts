import { describe, expect, it } from 'vitest'
import type { ConnectorProps, TableProps } from '@genoffice/whiteboard-engine'
import { ensureWhiteboardEngineSync } from '@genoffice/whiteboard-engine/node'
import {
  computeAlignUpdates,
  computeDistributeUpdates,
  computeGroupResize,
  computeRotationDegrees,
  computeSingleResize,
  computeSnapGuides,
  expandGroupSelection,
  isObjectLocked,
  normalizeRect,
  objectHitsPoint,
  objectIntersectsRect,
  searchBoardObjects,
  selectionBounds,
} from '../src/renderer/canvas/geometry'
import {
  BUILTIN_TEMPLATES,
  buildBuiltinTemplate,
  type TemplateLocalizedLabels,
} from '../src/renderer/canvas/templates'
import { WhiteboardSession } from '../src/renderer/document/session'
import { renderPageToSvg, richTextPlain } from '../src/renderer/export/render-svg'

const TEST_LABELS: TemplateLocalizedLabels = {
  title: 'Board',
  kanbanTodo: 'To Do',
  kanbanDoing: 'In Progress',
  kanbanDone: 'Done',
  swotS: 'Strengths',
  swotW: 'Weaknesses',
  swotO: 'Opportunities',
  swotT: 'Threats',
  kptKeep: 'Keep',
  kptProblem: 'Problem',
  kptTry: 'Try',
  flowStart: 'Start',
  flowReview: 'Review',
  flowDecision: 'Approved?',
  flowApprove: 'Complete',
  flowRevise: 'Revise',
  matrixQ1: 'Quick Wins',
  matrixQ2: 'Major Projects',
  matrixQ3: 'Fill-ins',
  matrixQ4: 'Reconsider',
  matrixHighImpact: 'High Impact',
  matrixLowEffort: 'Effort',
  timelinePhase: 'Phase',
  sampleItem: 'Item',
  mindmapTopic: 'Central Topic',
  mindmapBranch: 'Branch',
  mindmapIdea: 'Idea',
  journeyAwareness: 'Awareness',
  journeyConsider: 'Consideration',
  journeyDecision: 'Decision',
  journeyUse: 'Usage',
  journeyAdvocate: 'Advocacy',
  journeyActions: 'User Actions',
  journeyTouchpoint: 'Touchpoints',
  journeyOpportunity: 'Opportunities',
  meetingMeta: 'Date: 2026-11-23',
  meetingAgenda: 'Agenda',
  meetingDecisions: 'Decisions',
  meetingActions: 'Action Items',
  meetingColTask: 'Task',
  meetingColOwner: 'Owner',
  meetingColDue: 'Due',
  meetingColStatus: 'Status',
  bmcPartners: 'Key Partners',
  bmcActivities: 'Key Activities',
  bmcResources: 'Key Resources',
  bmcValue: 'Value Propositions',
  bmcRelations: 'Customer Relations',
  bmcChannels: 'Channels',
  bmcSegments: 'Customer Segments',
  bmcCost: 'Cost Structure',
  bmcRevenue: 'Revenue Streams',
  fishboneProblem: 'Core Problem',
  fishbonePeople: 'People',
  fishboneProcess: 'Process',
  fishboneTools: 'Tools',
  fishboneEnv: 'Environment',
  fishboneCause: 'Cause',
  okrObjective: 'Quarterly Objective',
  okrKr: 'Key Result',
  okrInitiative: 'Initiative',
  okrColMetric: 'Metric',
  okrColTarget: 'Target',
  okrColCurrent: 'Current',
}

describe('Whiteboard geometry: marquee, snapping, align/distribute, resize, rotate, search', () => {
  it('detects marquee intersection for boxes and connectors and expands groups', () => {
    ensureWhiteboardEngineSync()
    const session = WhiteboardSession.createBlank('Marquee Test')
    const a = session.addObject({
      kind: 'sticky',
      x: 50,
      y: 50,
      width: 100,
      height: 100,
      text: 'A',
    })!
    const b = session.addObject({
      kind: 'sticky',
      x: 260,
      y: 50,
      width: 100,
      height: 100,
      text: 'B',
    })!
    const c = session.addObject({
      kind: 'sticky',
      x: 600,
      y: 600,
      width: 100,
      height: 100,
      text: 'C',
    })!
    const conn = session.addObject({
      kind: 'connector',
      start: { objectId: a.id, anchorX: 1, anchorY: 0.5 },
      end: { objectId: b.id, anchorX: 0, anchorY: 0.5 },
    })!

    const objs = session.getDocument().objects
    const byId = new Map(objs.map((o) => [o.id, o]))

    // Drag marquee across connector between A and B (and overlapping A).
    const rect = normalizeRect({ x: 200, y: 120 }, { x: 100, y: 60 })
    expect(objectIntersectsRect(a, rect, byId)).toBe(true)
    expect(objectIntersectsRect(conn, rect, byId)).toBe(true)
    expect(objectIntersectsRect(c, rect, byId)).toBe(false)

    // Point hit test for drag eraser.
    expect(objectHitsPoint(conn, { x: 205, y: 100 }, byId, 8)).toBe(true)
    expect(objectHitsPoint(c, { x: 205, y: 100 }, byId, 8)).toBe(false)

    // Grouping expands single selection to entire group.
    session.groupObjects([a.id, b.id])
    const groupedObjs = session.getDocument().objects
    expect(expandGroupSelection([a.id], groupedObjs).sort()).toEqual([a.id, b.id].sort())

    session.dispose()
  })

  it('computes magnetic smart guides and multi-object align/distribute patches', () => {
    ensureWhiteboardEngineSync()
    const session = WhiteboardSession.createBlank('Layout Test')
    const o1 = session.addObject({ kind: 'shape', x: 100, y: 100, width: 100, height: 60 })!
    const o2 = session.addObject({ kind: 'shape', x: 230, y: 150, width: 80, height: 60 })!
    const o3 = session.addObject({ kind: 'shape', x: 500, y: 260, width: 100, height: 60 })!
    const objs = session.getDocument().objects

    // Moving rect near o1's left edge (x=103 -> snaps by -3 to x=100).
    const snap = computeSnapGuides(
      { x: 103, y: 300, width: 80, height: 50 },
      [{ x: o1.x, y: o1.y, width: o1.width, height: o1.height }],
      6,
    )
    expect(snap.snapDx).toBe(-3)
    expect(snap.guides).toHaveLength(1)
    expect(snap.guides[0]!.axis).toBe('x')
    expect(snap.guides[0]!.value).toBe(100)

    // Align left brings o2 and o3 to x=100.
    const leftUpdates = computeAlignUpdates(objs, 'left')
    expect(leftUpdates).toEqual([
      { id: o2.id, x: 100, y: 150 },
      { id: o3.id, x: 100, y: 260 },
    ])

    // Distribute horizontally spaces middle object evenly between x=100..600.
    const distH = computeDistributeUpdates(objs, 'horizontal')
    // Total span = 500 (100..600), sumW = 280 -> gap = 110 -> o2.x = 100 + 100 + 110 = 310
    expect(distH).toEqual([{ id: o2.id, x: 310, y: 150 }])

    // Selection bounds encloses all 3 shapes.
    const byId = new Map(objs.map((o) => [o.id, o]))
    expect(selectionBounds(objs, byId)).toEqual({ x: 100, y: 100, width: 500, height: 220 })

    session.dispose()
  })

  it('computes 8-handle single resize, aspect lock, proportional group resize, and rotation snap', () => {
    const resized = computeSingleResize(
      { x: 100, y: 100, width: 200, height: 100 },
      'se',
      100,
      10,
      true,
    )
    expect(resized.width).toBe(300)
    expect(resized.height).toBe(150)

    const westEdge = computeSingleResize(
      { x: 100, y: 100, width: 200, height: 100 },
      'w',
      50,
      0,
      false,
    )
    expect(westEdge).toEqual({ x: 150, y: 100, width: 150, height: 100 })

    const grp = computeGroupResize(
      { x: 0, y: 0, width: 200, height: 100 },
      'se',
      200,
      100,
      [
        { id: 'a', rect: { x: 0, y: 0, width: 50, height: 50 } },
        { id: 'b', rect: { x: 100, y: 50, width: 100, height: 50 } },
      ],
      false,
    )
    expect(grp.get('a')).toEqual({ x: 0, y: 0, width: 100, height: 100 })
    expect(grp.get('b')).toEqual({ x: 200, y: 100, width: 200, height: 100 })

    // Rotation: pointing straight right from center = 90 deg; Shift snaps to 15 deg increments.
    expect(computeRotationDegrees({ x: 100, y: 100 }, { x: 200, y: 100 }, false)).toBe(90)
    expect(computeRotationDegrees({ x: 100, y: 100 }, { x: 110, y: 0 }, true) % 15).toBe(0)
  })

  it('searches text across stickies, tables, connectors, links, and multiple pages', () => {
    ensureWhiteboardEngineSync()
    const session = WhiteboardSession.createBlank('Search Board')
    const p1 = session.getActivePageId()
    const s1 = session.addObject({ kind: 'sticky', x: 10, y: 10, text: 'Alpha launch checklist' })!
    const tbl = session.addObject({
      kind: 'table',
      x: 10,
      y: 250,
      rows: 2,
      cols: 2,
      data: [
        ['Task', 'Owner'],
        ['Launch review', 'Min'],
      ],
    })!
    const p2 = session.addPage('freeform', 'Page 2')!
    const lnk = session.addObject({
      kind: 'link',
      x: 20,
      y: 20,
      url: 'https://example.com/launch',
      title: 'Launch Docs',
    })!

    const hits = searchBoardObjects(session.getDocument(), 'launch', p1)
    expect(hits.map((h) => h.objectId)).toEqual([s1.id, tbl.id, lnk.id])
    expect(hits[2]!.pageId).toBe(p2.id)

    session.dispose()
  })
})

describe('WhiteboardSession advanced operations & built-in templates', () => {
  it('supports lock persistence across save/reopen, grouping, 4-way layer order, duplicate, and table edits', async () => {
    ensureWhiteboardEngineSync()
    const session = WhiteboardSession.createBlank('Ops Test')
    const n1 = session.addObject({ kind: 'sticky', x: 40, y: 40, text: 'One' })!
    const n2 = session.addObject({ kind: 'sticky', x: 280, y: 40, text: 'Two' })!
    const c1 = session.addObject({
      kind: 'connector',
      start: { objectId: n1.id, anchorX: 1, anchorY: 0.5 },
      end: { objectId: n2.id, anchorX: 0, anchorY: 0.5 },
    })!

    // Lock survives ZIP save and reopen.
    expect(session.toggleLock([n1.id], true)).toBe(true)
    expect(isObjectLocked(session.getDocument().objects.find((o) => o.id === n1.id)!)).toBe(true)
    const { bytes } = await session.serializeForSave({ updateThumbnail: false })
    const reopened = WhiteboardSession.fromBytes(bytes)
    expect(isObjectLocked(reopened.getDocument().objects.find((o) => o.id === n1.id)!)).toBe(true)
    reopened.dispose()

    // Duplicate selection remaps connector endpoints to the newly created copies.
    const duped = session.duplicateObjects([n1.id, n2.id, c1.id], { x: 40, y: 200 })
    expect(duped).toHaveLength(3)
    const dupConn = duped.find((o) => o.kind === 'connector')!
    const dupNodes = duped.filter((o) => o.kind === 'sticky').map((o) => o.id)
    const cp = dupConn.props as unknown as ConnectorProps
    expect('objectId' in cp.start && dupNodes.includes(cp.start.objectId)).toBe(true)
    expect('objectId' in cp.end && dupNodes.includes(cp.end.objectId)).toBe(true)

    // Layer order stepping.
    expect(session.stepLayerOrder([n1.id], 'front')).toBe(true)
    const sorted = [...session.getDocument().objects].sort((a, b) =>
      a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0,
    )
    expect(sorted.at(-1)!.id).toBe(n1.id)
    expect(session.stepLayerOrder([n1.id], 'backward')).toBe(true)

    // Table inline patch (cells + rows + cols).
    const tbl = session.addObject({ kind: 'table', x: 40, y: 400, rows: 2, cols: 2 })!
    expect(
      session.updateTable(tbl.id, {
        rows: 3,
        cols: 3,
        cells: [{ row: 2, col: 2, text: 'Bottom Right' }],
      }),
    ).toBe(true)
    const updatedTbl = session.getDocument().objects.find((o) => o.id === tbl.id)!
    const tp = updatedTbl.props as unknown as TableProps
    expect(tp.rowIds).toHaveLength(3)
    expect(tp.colIds).toHaveLength(3)
    expect(richTextPlain(tp.cells[`${tp.rowIds[2]}:${tp.colIds[2]}`])).toBe('Bottom Right')

    // Title, page duplicate, reorder, and background grid mode.
    expect(session.setTitle('Renamed Board')).toBe(true)
    expect(session.getDocument().title).toBe('Renamed Board')
    const p1Id = session.getDocument().pages[0]!.id
    const p2 = session.duplicatePage(p1Id)!
    expect(session.getDocument().pages).toHaveLength(2)
    expect(session.reorderPage(p2.id, 0)).toBe(true)
    expect(session.getDocument().pages[0]!.id).toBe(p2.id)

    expect(session.setPageGridMode(p2.id, 'line')).toBe(true)
    const svg = renderPageToSvg(session.getDocument(), p2.id, session.getAllResourceDataUrls())
    expect(svg!.svg).toContain('wb-grid-line')

    session.dispose()
  })

  it('applies every built-in template cleanly in one user undo step', () => {
    ensureWhiteboardEngineSync()
    for (const meta of BUILTIN_TEMPLATES) {
      const session = WhiteboardSession.createBlank('Template Check')
      const tpl = buildBuiltinTemplate(meta.id, 'current_page', TEST_LABELS)
      const res = session.applyUserTemplate(tpl)
      expect(res.ok, meta.id).toBe(true)
      expect(session.getDocument().objects.length, meta.id).toBeGreaterThan(3)
      // Must undo cleanly in 1 step.
      expect(session.undo(), meta.id).toBe(true)
      expect(session.getDocument().objects, meta.id).toHaveLength(0)
      session.dispose()
    }
  })
})
