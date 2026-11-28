/**
 * Built-in Miro-inspired board templates (12 templates across 3 categories)
 * powered by `@genoffice/whiteboard-engine`'s declarative `applyTemplate` engine.
 */

export type BuiltinTemplateCategory = 'strategy' | 'brainstorm' | 'collaboration'

export type BuiltinTemplateId =
  | 'kanban'
  | 'swot'
  | 'kpt'
  | 'flowchart'
  | 'matrix_2x2'
  | 'timeline'
  | 'mindmap'
  | 'user_journey'
  | 'meeting_notes'
  | 'bmc'
  | 'fishbone'
  | 'okr'

export interface BuiltinTemplateMeta {
  readonly id: BuiltinTemplateId
  readonly category: BuiltinTemplateCategory
  readonly titleKey:
    | 'tplKanbanTitle'
    | 'tplSwotTitle'
    | 'tplKptTitle'
    | 'tplFlowchartTitle'
    | 'tplMatrixTitle'
    | 'tplTimelineTitle'
    | 'tplMindmapTitle'
    | 'tplJourneyTitle'
    | 'tplMeetingTitle'
    | 'tplBmcTitle'
    | 'tplFishboneTitle'
    | 'tplOkrTitle'
  readonly descKey:
    | 'tplKanbanDesc'
    | 'tplSwotDesc'
    | 'tplKptDesc'
    | 'tplFlowchartDesc'
    | 'tplMatrixDesc'
    | 'tplTimelineDesc'
    | 'tplMindmapDesc'
    | 'tplJourneyDesc'
    | 'tplMeetingDesc'
    | 'tplBmcDesc'
    | 'tplFishboneDesc'
    | 'tplOkrDesc'
}

export const BUILTIN_TEMPLATES: readonly BuiltinTemplateMeta[] = [
  { id: 'kanban', category: 'collaboration', titleKey: 'tplKanbanTitle', descKey: 'tplKanbanDesc' },
  { id: 'swot', category: 'strategy', titleKey: 'tplSwotTitle', descKey: 'tplSwotDesc' },
  { id: 'kpt', category: 'collaboration', titleKey: 'tplKptTitle', descKey: 'tplKptDesc' },
  {
    id: 'flowchart',
    category: 'collaboration',
    titleKey: 'tplFlowchartTitle',
    descKey: 'tplFlowchartDesc',
  },
  { id: 'matrix_2x2', category: 'strategy', titleKey: 'tplMatrixTitle', descKey: 'tplMatrixDesc' },
  {
    id: 'timeline',
    category: 'strategy',
    titleKey: 'tplTimelineTitle',
    descKey: 'tplTimelineDesc',
  },
  { id: 'mindmap', category: 'brainstorm', titleKey: 'tplMindmapTitle', descKey: 'tplMindmapDesc' },
  {
    id: 'user_journey',
    category: 'strategy',
    titleKey: 'tplJourneyTitle',
    descKey: 'tplJourneyDesc',
  },
  {
    id: 'meeting_notes',
    category: 'collaboration',
    titleKey: 'tplMeetingTitle',
    descKey: 'tplMeetingDesc',
  },
  { id: 'bmc', category: 'strategy', titleKey: 'tplBmcTitle', descKey: 'tplBmcDesc' },
  {
    id: 'fishbone',
    category: 'brainstorm',
    titleKey: 'tplFishboneTitle',
    descKey: 'tplFishboneDesc',
  },
  { id: 'okr', category: 'strategy', titleKey: 'tplOkrTitle', descKey: 'tplOkrDesc' },
] as const

export interface TemplateLocalizedLabels {
  readonly title: string
  readonly kanbanTodo: string
  readonly kanbanDoing: string
  readonly kanbanDone: string
  readonly swotS: string
  readonly swotW: string
  readonly swotO: string
  readonly swotT: string
  readonly kptKeep: string
  readonly kptProblem: string
  readonly kptTry: string
  readonly flowStart: string
  readonly flowReview: string
  readonly flowDecision: string
  readonly flowApprove: string
  readonly flowRevise: string
  readonly matrixQ1: string
  readonly matrixQ2: string
  readonly matrixQ3: string
  readonly matrixQ4: string
  readonly matrixHighImpact: string
  readonly matrixLowEffort: string
  readonly timelinePhase: string
  readonly sampleItem: string
  readonly mindmapTopic: string
  readonly mindmapBranch: string
  readonly mindmapIdea: string
  readonly journeyAwareness: string
  readonly journeyConsider: string
  readonly journeyDecision: string
  readonly journeyUse: string
  readonly journeyAdvocate: string
  readonly journeyActions: string
  readonly journeyTouchpoint: string
  readonly journeyOpportunity: string
  readonly meetingMeta: string
  readonly meetingAgenda: string
  readonly meetingDecisions: string
  readonly meetingActions: string
  readonly meetingColTask: string
  readonly meetingColOwner: string
  readonly meetingColDue: string
  readonly meetingColStatus: string
  readonly bmcPartners: string
  readonly bmcActivities: string
  readonly bmcResources: string
  readonly bmcValue: string
  readonly bmcRelations: string
  readonly bmcChannels: string
  readonly bmcSegments: string
  readonly bmcCost: string
  readonly bmcRevenue: string
  readonly fishboneProblem: string
  readonly fishbonePeople: string
  readonly fishboneProcess: string
  readonly fishboneTools: string
  readonly fishboneEnv: string
  readonly fishboneCause: string
  readonly okrObjective: string
  readonly okrKr: string
  readonly okrInitiative: string
  readonly okrColMetric: string
  readonly okrColTarget: string
  readonly okrColCurrent: string
}

/** Builds a validated declarative JSON template ready for `session.applyUserTemplate`. */
export function buildBuiltinTemplate(
  id: BuiltinTemplateId,
  target: 'current_page' | 'new_pages',
  labels: TemplateLocalizedLabels,
): Record<string, unknown> {
  switch (id) {
    case 'kanban':
      return {
        schemaVersion: 1,
        target,
        pages: [
          {
            key: 'kanban',
            title: labels.title,
            format: 'freeform',
            blocks: [
              {
                type: 'sticker',
                key: 'k_ico',
                stickerId: 'rocket',
                frame: { x: 48, y: 28, w: 48, h: 48 },
              },
              {
                type: 'title',
                key: 'hdr',
                text: labels.title,
                fontSize: 30,
                frame: { x: 108, y: 34, w: 480, h: 44 },
              },
              // Column 1: To Do
              {
                type: 'shape',
                key: 'col_todo_zone',
                shape: 'rounded_rectangle',
                fill: '#F7F5F0',
                stroke: '#CBD5E1',
                strokeWidth: 1.5,
                frame: { x: 48, y: 104, w: 300, h: 560 },
              },
              {
                type: 'text',
                key: 'col_todo_pill',
                text: labels.kanbanTodo,
                fontSize: 16,
                fill: '#FFFFFF',
                stroke: '#CBD5E1',
                align: 'center',
                frame: { x: 68, y: 120, w: 260, h: 46 },
              },
              {
                type: 'sticky',
                key: 'todo_1',
                color: '#FFF3A1',
                text: `${labels.sampleItem} 1`,
                frame: { x: 74, y: 184, w: 248, h: 136 },
              },
              {
                type: 'sticky',
                key: 'todo_2',
                color: '#FFF3A1',
                text: `${labels.sampleItem} 2`,
                frame: { x: 74, y: 340, w: 248, h: 136 },
              },
              {
                type: 'sticky',
                key: 'todo_3',
                color: '#FFDAB3',
                text: `${labels.sampleItem} 3`,
                frame: { x: 74, y: 496, w: 248, h: 136 },
              },
              // Column 2: In Progress
              {
                type: 'shape',
                key: 'col_doing_zone',
                shape: 'rounded_rectangle',
                fill: '#EEF6FF',
                stroke: '#60A5FA',
                strokeWidth: 1.5,
                frame: { x: 376, y: 104, w: 300, h: 560 },
              },
              {
                type: 'text',
                key: 'col_doing_pill',
                text: labels.kanbanDoing,
                fontSize: 16,
                fill: '#FFFFFF',
                stroke: '#60A5FA',
                align: 'center',
                frame: { x: 396, y: 120, w: 260, h: 46 },
              },
              {
                type: 'sticky',
                key: 'doing_1',
                color: '#CBE4FF',
                text: `${labels.sampleItem} 4`,
                frame: { x: 402, y: 184, w: 248, h: 136 },
              },
              {
                type: 'sticky',
                key: 'doing_2',
                color: '#E3D7FF',
                text: `${labels.sampleItem} 5`,
                frame: { x: 402, y: 340, w: 248, h: 136 },
              },
              // Column 3: Done
              {
                type: 'shape',
                key: 'col_done_zone',
                shape: 'rounded_rectangle',
                fill: '#ECFDF3',
                stroke: '#34D399',
                strokeWidth: 1.5,
                frame: { x: 704, y: 104, w: 300, h: 560 },
              },
              {
                type: 'text',
                key: 'col_done_pill',
                text: labels.kanbanDone,
                fontSize: 16,
                fill: '#FFFFFF',
                stroke: '#34D399',
                align: 'center',
                frame: { x: 724, y: 120, w: 260, h: 46 },
              },
              {
                type: 'sticky',
                key: 'done_1',
                color: '#CCF0D2',
                text: `${labels.sampleItem} 6`,
                frame: { x: 730, y: 184, w: 248, h: 136 },
              },
              {
                type: 'sticker',
                key: 'done_ico',
                stickerId: 'check',
                frame: { x: 940, y: 112, w: 42, h: 42 },
              },
            ],
          },
        ],
      }

    case 'swot':
      return {
        schemaVersion: 1,
        target,
        pages: [
          {
            key: 'swot',
            title: labels.title,
            format: 'freeform',
            blocks: [
              {
                type: 'sticker',
                key: 'sw_ico',
                stickerId: 'sparkle',
                frame: { x: 48, y: 28, w: 46, h: 46 },
              },
              {
                type: 'title',
                key: 'hdr',
                text: labels.title,
                fontSize: 30,
                frame: { x: 106, y: 34, w: 480, h: 44 },
              },
              // Strengths
              {
                type: 'shape',
                key: 'q_s',
                shape: 'rounded_rectangle',
                fill: '#ECFDF3',
                stroke: '#34D399',
                strokeWidth: 1.75,
                frame: { x: 48, y: 104, w: 460, h: 284 },
              },
              {
                type: 'text',
                key: 'q_s_lbl',
                text: labels.swotS,
                fontSize: 16,
                fill: '#FFFFFF',
                stroke: '#34D399',
                align: 'center',
                frame: { x: 68, y: 120, w: 210, h: 46 },
              },
              {
                type: 'sticky',
                key: 'q_s_n1',
                color: '#CCF0D2',
                text: `${labels.sampleItem} 1`,
                frame: { x: 72, y: 180, w: 196, h: 176 },
              },
              {
                type: 'sticky',
                key: 'q_s_n2',
                color: '#CCF0D2',
                text: `${labels.sampleItem} 2`,
                frame: { x: 288, y: 180, w: 196, h: 176 },
              },
              // Weaknesses
              {
                type: 'shape',
                key: 'q_w',
                shape: 'rounded_rectangle',
                fill: '#FFF1F2',
                stroke: '#FB7185',
                strokeWidth: 1.75,
                frame: { x: 532, y: 104, w: 460, h: 284 },
              },
              {
                type: 'text',
                key: 'q_w_lbl',
                text: labels.swotW,
                fontSize: 16,
                fill: '#FFFFFF',
                stroke: '#FB7185',
                align: 'center',
                frame: { x: 552, y: 120, w: 210, h: 46 },
              },
              {
                type: 'sticky',
                key: 'q_w_n1',
                color: '#FFD1D8',
                text: `${labels.sampleItem} 1`,
                frame: { x: 556, y: 180, w: 196, h: 176 },
              },
              {
                type: 'sticky',
                key: 'q_w_n2',
                color: '#FFD1D8',
                text: `${labels.sampleItem} 2`,
                frame: { x: 772, y: 180, w: 196, h: 176 },
              },
              // Opportunities
              {
                type: 'shape',
                key: 'q_o',
                shape: 'rounded_rectangle',
                fill: '#EEF6FF',
                stroke: '#60A5FA',
                strokeWidth: 1.75,
                frame: { x: 48, y: 412, w: 460, h: 284 },
              },
              {
                type: 'text',
                key: 'q_o_lbl',
                text: labels.swotO,
                fontSize: 16,
                fill: '#FFFFFF',
                stroke: '#60A5FA',
                align: 'center',
                frame: { x: 68, y: 428, w: 210, h: 46 },
              },
              {
                type: 'sticky',
                key: 'q_o_n1',
                color: '#CBE4FF',
                text: `${labels.sampleItem} 1`,
                frame: { x: 72, y: 488, w: 196, h: 176 },
              },
              {
                type: 'sticky',
                key: 'q_o_n2',
                color: '#CBE4FF',
                text: `${labels.sampleItem} 2`,
                frame: { x: 288, y: 488, w: 196, h: 176 },
              },
              // Threats
              {
                type: 'shape',
                key: 'q_t',
                shape: 'rounded_rectangle',
                fill: '#FFFBEB',
                stroke: '#F59E0B',
                strokeWidth: 1.75,
                frame: { x: 532, y: 412, w: 460, h: 284 },
              },
              {
                type: 'text',
                key: 'q_t_lbl',
                text: labels.swotT,
                fontSize: 16,
                fill: '#FFFFFF',
                stroke: '#F59E0B',
                align: 'center',
                frame: { x: 552, y: 428, w: 210, h: 46 },
              },
              {
                type: 'sticky',
                key: 'q_t_n1',
                color: '#FFDAB3',
                text: `${labels.sampleItem} 1`,
                frame: { x: 556, y: 488, w: 196, h: 176 },
              },
              {
                type: 'sticky',
                key: 'q_t_n2',
                color: '#FFDAB3',
                text: `${labels.sampleItem} 2`,
                frame: { x: 772, y: 488, w: 196, h: 176 },
              },
            ],
          },
        ],
      }

    case 'kpt':
      return {
        schemaVersion: 1,
        target,
        pages: [
          {
            key: 'kpt',
            title: labels.title,
            format: 'freeform',
            blocks: [
              {
                type: 'sticker',
                key: 'kpt_ico',
                stickerId: 'bulb',
                frame: { x: 48, y: 28, w: 46, h: 46 },
              },
              {
                type: 'title',
                key: 'hdr',
                text: labels.title,
                fontSize: 30,
                frame: { x: 106, y: 34, w: 480, h: 44 },
              },
              // Keep
              {
                type: 'shape',
                key: 'k_zone',
                shape: 'rounded_rectangle',
                fill: '#ECFDF3',
                stroke: '#34D399',
                strokeWidth: 1.5,
                frame: { x: 48, y: 104, w: 300, h: 510 },
              },
              {
                type: 'text',
                key: 'k_lbl',
                text: labels.kptKeep,
                fontSize: 16,
                fill: '#FFFFFF',
                stroke: '#34D399',
                align: 'center',
                frame: { x: 68, y: 120, w: 260, h: 46 },
              },
              {
                type: 'sticky',
                key: 'k_1',
                color: '#CCF0D2',
                text: `${labels.sampleItem} 1`,
                frame: { x: 74, y: 184, w: 248, h: 160 },
              },
              {
                type: 'sticky',
                key: 'k_2',
                color: '#CCF0D2',
                text: `${labels.sampleItem} 2`,
                frame: { x: 74, y: 368, w: 248, h: 160 },
              },
              // Problem
              {
                type: 'shape',
                key: 'p_zone',
                shape: 'rounded_rectangle',
                fill: '#FFF1F2',
                stroke: '#FB7185',
                strokeWidth: 1.5,
                frame: { x: 376, y: 104, w: 300, h: 510 },
              },
              {
                type: 'text',
                key: 'p_lbl',
                text: labels.kptProblem,
                fontSize: 16,
                fill: '#FFFFFF',
                stroke: '#FB7185',
                align: 'center',
                frame: { x: 396, y: 120, w: 260, h: 46 },
              },
              {
                type: 'sticky',
                key: 'p_1',
                color: '#FFD1D8',
                text: `${labels.sampleItem} 1`,
                frame: { x: 402, y: 184, w: 248, h: 160 },
              },
              {
                type: 'sticky',
                key: 'p_2',
                color: '#FFD1D8',
                text: `${labels.sampleItem} 2`,
                frame: { x: 402, y: 368, w: 248, h: 160 },
              },
              // Try
              {
                type: 'shape',
                key: 't_zone',
                shape: 'rounded_rectangle',
                fill: '#EEF6FF',
                stroke: '#60A5FA',
                strokeWidth: 1.5,
                frame: { x: 704, y: 104, w: 300, h: 510 },
              },
              {
                type: 'text',
                key: 't_lbl',
                text: labels.kptTry,
                fontSize: 16,
                fill: '#FFFFFF',
                stroke: '#60A5FA',
                align: 'center',
                frame: { x: 724, y: 120, w: 260, h: 46 },
              },
              {
                type: 'sticky',
                key: 't_1',
                color: '#CBE4FF',
                text: `${labels.sampleItem} 1`,
                frame: { x: 730, y: 184, w: 248, h: 160 },
              },
              {
                type: 'sticky',
                key: 't_2',
                color: '#CBE4FF',
                text: `${labels.sampleItem} 2`,
                frame: { x: 730, y: 368, w: 248, h: 160 },
              },
              {
                type: 'connector',
                key: 'p_to_t',
                from: { key: 'p_1', anchorX: 1, anchorY: 0.5 },
                to: { key: 't_1', anchorX: 0, anchorY: 0.5 },
                routing: 'curved',
                color: '#2563EB',
              },
            ],
          },
        ],
      }

    case 'flowchart':
      return {
        schemaVersion: 1,
        target,
        pages: [
          {
            key: 'flowchart',
            title: labels.title,
            format: 'freeform',
            blocks: [
              {
                type: 'sticker',
                key: 'fl_ico',
                stickerId: 'flag',
                frame: { x: 48, y: 28, w: 46, h: 46 },
              },
              {
                type: 'title',
                key: 'hdr',
                text: labels.title,
                fontSize: 30,
                frame: { x: 106, y: 34, w: 480, h: 44 },
              },
              {
                type: 'shape',
                key: 'n_start',
                shape: 'ellipse',
                fill: '#EEF6FF',
                stroke: '#60A5FA',
                strokeWidth: 2,
                text: labels.flowStart,
                frame: { x: 56, y: 204, w: 168, h: 92 },
              },
              {
                type: 'shape',
                key: 'n_review',
                shape: 'rounded_rectangle',
                fill: '#FFFFFF',
                stroke: '#CBD5E1',
                strokeWidth: 2,
                text: labels.flowReview,
                frame: { x: 296, y: 196, w: 196, h: 108 },
              },
              {
                type: 'shape',
                key: 'n_decision',
                shape: 'diamond',
                fill: '#FFFBEB',
                stroke: '#F59E0B',
                strokeWidth: 2,
                text: labels.flowDecision,
                frame: { x: 564, y: 176, w: 180, h: 148 },
              },
              {
                type: 'shape',
                key: 'n_approve',
                shape: 'ellipse',
                fill: '#ECFDF3',
                stroke: '#34D399',
                strokeWidth: 2,
                text: labels.flowApprove,
                frame: { x: 836, y: 120, w: 196, h: 96 },
              },
              {
                type: 'sticker',
                key: 'fl_done_ico',
                stickerId: 'check',
                frame: { x: 1012, y: 104, w: 40, h: 40 },
              },
              {
                type: 'shape',
                key: 'n_revise',
                shape: 'rounded_rectangle',
                fill: '#FFF1F2',
                stroke: '#FB7185',
                strokeWidth: 2,
                text: labels.flowRevise,
                frame: { x: 556, y: 396, w: 196, h: 96 },
              },
              {
                type: 'connector',
                key: 'c1',
                from: { key: 'n_start', anchorX: 1, anchorY: 0.5 },
                to: { key: 'n_review', anchorX: 0, anchorY: 0.5 },
                routing: 'curved',
                color: '#475569',
              },
              {
                type: 'connector',
                key: 'c2',
                from: { key: 'n_review', anchorX: 1, anchorY: 0.5 },
                to: { key: 'n_decision', anchorX: 0, anchorY: 0.5 },
                routing: 'curved',
                color: '#475569',
              },
              {
                type: 'connector',
                key: 'c3',
                from: { key: 'n_decision', anchorX: 1, anchorY: 0.5 },
                to: { key: 'n_approve', anchorX: 0, anchorY: 0.5 },
                routing: 'curved',
                color: '#16A34A',
                label: 'Yes',
              },
              {
                type: 'connector',
                key: 'c4',
                from: { key: 'n_decision', anchorX: 0.5, anchorY: 1 },
                to: { key: 'n_revise', anchorX: 0.5, anchorY: 0 },
                routing: 'straight',
                color: '#E11D48',
                label: 'No',
              },
              {
                type: 'connector',
                key: 'c5',
                from: { key: 'n_revise', anchorX: 0, anchorY: 0.5 },
                to: { key: 'n_review', anchorX: 0.5, anchorY: 1 },
                routing: 'elbow',
                color: '#E11D48',
              },
            ],
          },
        ],
      }

    case 'matrix_2x2':
      return {
        schemaVersion: 1,
        target,
        pages: [
          {
            key: 'matrix',
            title: labels.title,
            format: 'freeform',
            blocks: [
              {
                type: 'sticker',
                key: 'mx_ico',
                stickerId: 'star',
                frame: { x: 48, y: 28, w: 46, h: 46 },
              },
              {
                type: 'title',
                key: 'hdr',
                text: labels.title,
                fontSize: 30,
                frame: { x: 106, y: 34, w: 480, h: 44 },
              },
              {
                type: 'text',
                key: 'axis_y_lbl',
                text: `↑ ${labels.matrixHighImpact}`,
                fontSize: 14,
                color: '#475569',
                align: 'center',
                frame: { x: 420, y: 84, w: 180, h: 28 },
              },
              {
                type: 'shape',
                key: 'm1',
                shape: 'rounded_rectangle',
                fill: '#ECFDF3',
                stroke: '#34D399',
                strokeWidth: 1.5,
                frame: { x: 56, y: 120, w: 438, h: 274 },
              },
              {
                type: 'text',
                key: 'm1_lbl',
                text: labels.matrixQ1,
                fontSize: 16,
                fill: '#FFFFFF',
                stroke: '#34D399',
                align: 'center',
                frame: { x: 76, y: 134, w: 190, h: 46 },
              },
              {
                type: 'sticky',
                key: 'm1_n1',
                color: '#CCF0D2',
                text: `${labels.sampleItem} 1`,
                frame: { x: 80, y: 192, w: 184, h: 170 },
              },
              {
                type: 'sticky',
                key: 'm1_n2',
                color: '#CCF0D2',
                text: `${labels.sampleItem} 2`,
                frame: { x: 284, y: 192, w: 184, h: 170 },
              },
              {
                type: 'shape',
                key: 'm2',
                shape: 'rounded_rectangle',
                fill: '#EEF6FF',
                stroke: '#60A5FA',
                strokeWidth: 1.5,
                frame: { x: 518, y: 120, w: 438, h: 274 },
              },
              {
                type: 'text',
                key: 'm2_lbl',
                text: labels.matrixQ2,
                fontSize: 16,
                fill: '#FFFFFF',
                stroke: '#60A5FA',
                align: 'center',
                frame: { x: 538, y: 134, w: 190, h: 46 },
              },
              {
                type: 'sticky',
                key: 'm2_n1',
                color: '#CBE4FF',
                text: `${labels.sampleItem} 3`,
                frame: { x: 542, y: 192, w: 184, h: 170 },
              },
              {
                type: 'shape',
                key: 'm3',
                shape: 'rounded_rectangle',
                fill: '#FFFBEB',
                stroke: '#F59E0B',
                strokeWidth: 1.5,
                frame: { x: 56, y: 416, w: 438, h: 274 },
              },
              {
                type: 'text',
                key: 'm3_lbl',
                text: labels.matrixQ3,
                fontSize: 16,
                fill: '#FFFFFF',
                stroke: '#F59E0B',
                align: 'center',
                frame: { x: 76, y: 430, w: 190, h: 46 },
              },
              {
                type: 'sticky',
                key: 'm3_n1',
                color: '#FFF3A1',
                text: `${labels.sampleItem} 4`,
                frame: { x: 80, y: 488, w: 184, h: 170 },
              },
              {
                type: 'shape',
                key: 'm4',
                shape: 'rounded_rectangle',
                fill: '#F7F5F0',
                stroke: '#C7C0B3',
                strokeWidth: 1.5,
                frame: { x: 518, y: 416, w: 438, h: 274 },
              },
              {
                type: 'text',
                key: 'm4_lbl',
                text: labels.matrixQ4,
                fontSize: 16,
                fill: '#FFFFFF',
                stroke: '#C7C0B3',
                align: 'center',
                frame: { x: 538, y: 430, w: 190, h: 46 },
              },
              {
                type: 'sticky',
                key: 'm4_n1',
                color: '#FFFFFF',
                text: `${labels.sampleItem} 5`,
                frame: { x: 542, y: 488, w: 184, h: 170 },
              },
              {
                type: 'text',
                key: 'axis_x_lbl',
                text: `${labels.matrixLowEffort} →`,
                fontSize: 14,
                color: '#475569',
                align: 'right',
                frame: { x: 760, y: 702, w: 196, h: 28 },
              },
            ],
          },
        ],
      }

    case 'timeline':
      return {
        schemaVersion: 1,
        target,
        pages: [
          {
            key: 'timeline',
            title: labels.title,
            format: 'freeform',
            blocks: [
              {
                type: 'sticker',
                key: 'tl_ico',
                stickerId: 'clock',
                frame: { x: 48, y: 28, w: 46, h: 46 },
              },
              {
                type: 'title',
                key: 'hdr',
                text: labels.title,
                fontSize: 30,
                frame: { x: 106, y: 34, w: 480, h: 44 },
              },
              // Phase nodes
              {
                type: 'shape',
                key: 'p1',
                shape: 'rounded_rectangle',
                fill: '#EEF6FF',
                stroke: '#60A5FA',
                strokeWidth: 2,
                text: `${labels.timelinePhase} 1`,
                frame: { x: 48, y: 120, w: 224, h: 84 },
              },
              {
                type: 'shape',
                key: 'p2',
                shape: 'rounded_rectangle',
                fill: '#F5F3FF',
                stroke: '#A78BFA',
                strokeWidth: 2,
                text: `${labels.timelinePhase} 2`,
                frame: { x: 316, y: 120, w: 224, h: 84 },
              },
              {
                type: 'shape',
                key: 'p3',
                shape: 'rounded_rectangle',
                fill: '#FFFBEB',
                stroke: '#F59E0B',
                strokeWidth: 2,
                text: `${labels.timelinePhase} 3`,
                frame: { x: 584, y: 120, w: 224, h: 84 },
              },
              {
                type: 'shape',
                key: 'p4',
                shape: 'rounded_rectangle',
                fill: '#ECFDF3',
                stroke: '#34D399',
                strokeWidth: 2,
                text: `${labels.timelinePhase} 4`,
                frame: { x: 852, y: 120, w: 224, h: 84 },
              },
              {
                type: 'sticker',
                key: 'tl_s1',
                stickerId: 'one',
                frame: { x: 36, y: 104, w: 36, h: 36 },
              },
              {
                type: 'sticker',
                key: 'tl_s2',
                stickerId: 'two',
                frame: { x: 304, y: 104, w: 36, h: 36 },
              },
              {
                type: 'sticker',
                key: 'tl_s3',
                stickerId: 'three',
                frame: { x: 572, y: 104, w: 36, h: 36 },
              },
              {
                type: 'sticker',
                key: 'tl_s4',
                stickerId: 'trophy',
                frame: { x: 840, y: 104, w: 38, h: 38 },
              },
              {
                type: 'connector',
                key: 'tc1',
                from: { key: 'p1', anchorX: 1, anchorY: 0.5 },
                to: { key: 'p2', anchorX: 0, anchorY: 0.5 },
                routing: 'straight',
                color: '#475569',
              },
              {
                type: 'connector',
                key: 'tc2',
                from: { key: 'p2', anchorX: 1, anchorY: 0.5 },
                to: { key: 'p3', anchorX: 0, anchorY: 0.5 },
                routing: 'straight',
                color: '#475569',
              },
              {
                type: 'connector',
                key: 'tc3',
                from: { key: 'p3', anchorX: 1, anchorY: 0.5 },
                to: { key: 'p4', anchorX: 0, anchorY: 0.5 },
                routing: 'straight',
                color: '#475569',
              },
              // Deliverable zones & stickies
              {
                type: 'zone',
                key: 'z1',
                fill: '#F7F5F0',
                stroke: '#CBD5E1',
                frame: { x: 48, y: 232, w: 224, h: 344 },
              },
              {
                type: 'sticky',
                key: 'pn1a',
                color: '#CBE4FF',
                text: `${labels.sampleItem} 1-1`,
                frame: { x: 64, y: 252, w: 192, h: 140 },
              },
              {
                type: 'sticky',
                key: 'pn1b',
                color: '#CBE4FF',
                text: `${labels.sampleItem} 1-2`,
                frame: { x: 64, y: 412, w: 192, h: 140 },
              },
              {
                type: 'zone',
                key: 'z2',
                fill: '#F7F5F0',
                stroke: '#CBD5E1',
                frame: { x: 316, y: 232, w: 224, h: 344 },
              },
              {
                type: 'sticky',
                key: 'pn2a',
                color: '#E3D7FF',
                text: `${labels.sampleItem} 2-1`,
                frame: { x: 332, y: 252, w: 192, h: 140 },
              },
              {
                type: 'sticky',
                key: 'pn2b',
                color: '#E3D7FF',
                text: `${labels.sampleItem} 2-2`,
                frame: { x: 332, y: 412, w: 192, h: 140 },
              },
              {
                type: 'zone',
                key: 'z3',
                fill: '#F7F5F0',
                stroke: '#CBD5E1',
                frame: { x: 584, y: 232, w: 224, h: 344 },
              },
              {
                type: 'sticky',
                key: 'pn3a',
                color: '#FFF3A1',
                text: `${labels.sampleItem} 3-1`,
                frame: { x: 600, y: 252, w: 192, h: 140 },
              },
              {
                type: 'sticky',
                key: 'pn3b',
                color: '#FFF3A1',
                text: `${labels.sampleItem} 3-2`,
                frame: { x: 600, y: 412, w: 192, h: 140 },
              },
              {
                type: 'zone',
                key: 'z4',
                fill: '#F7F5F0',
                stroke: '#CBD5E1',
                frame: { x: 852, y: 232, w: 224, h: 344 },
              },
              {
                type: 'sticky',
                key: 'pn4a',
                color: '#CCF0D2',
                text: `${labels.sampleItem} 4-1`,
                frame: { x: 868, y: 252, w: 192, h: 140 },
              },
              {
                type: 'sticky',
                key: 'pn4b',
                color: '#CCF0D2',
                text: `${labels.sampleItem} 4-2`,
                frame: { x: 868, y: 412, w: 192, h: 140 },
              },
            ],
          },
        ],
      }

    case 'mindmap':
      return {
        schemaVersion: 1,
        target,
        pages: [
          {
            key: 'mindmap',
            title: labels.title,
            format: 'freeform',
            blocks: [
              {
                type: 'title',
                key: 'hdr',
                text: labels.title,
                fontSize: 28,
                frame: { x: 48, y: 28, w: 460, h: 42 },
              },
              // Central Topic
              {
                type: 'shape',
                key: 'mm_center',
                shape: 'ellipse',
                fill: '#FFFBEB',
                stroke: '#F59E0B',
                strokeWidth: 2.5,
                text: labels.mindmapTopic,
                fontSize: 20,
                frame: { x: 460, y: 274, w: 220, h: 124 },
              },
              {
                type: 'sticker',
                key: 'mm_ico',
                stickerId: 'bulb',
                frame: { x: 548, y: 236, w: 44, h: 44 },
              },
              // Left-top branch
              {
                type: 'shape',
                key: 'mm_b1',
                shape: 'rounded_rectangle',
                fill: '#EEF6FF',
                stroke: '#60A5FA',
                strokeWidth: 2,
                text: `${labels.mindmapBranch} 1`,
                frame: { x: 220, y: 128, w: 170, h: 72 },
              },
              {
                type: 'sticky',
                key: 'mm_b1_a',
                color: '#CBE4FF',
                text: `${labels.mindmapIdea} 1`,
                frame: { x: 36, y: 80, w: 144, h: 86 },
              },
              {
                type: 'sticky',
                key: 'mm_b1_b',
                color: '#CBE4FF',
                text: `${labels.mindmapIdea} 2`,
                frame: { x: 36, y: 184, w: 144, h: 86 },
              },
              // Left-bottom branch
              {
                type: 'shape',
                key: 'mm_b2',
                shape: 'rounded_rectangle',
                fill: '#ECFDF3',
                stroke: '#34D399',
                strokeWidth: 2,
                text: `${labels.mindmapBranch} 2`,
                frame: { x: 220, y: 460, w: 170, h: 72 },
              },
              {
                type: 'sticky',
                key: 'mm_b2_a',
                color: '#CCF0D2',
                text: `${labels.mindmapIdea} 3`,
                frame: { x: 36, y: 404, w: 144, h: 86 },
              },
              {
                type: 'sticky',
                key: 'mm_b2_b',
                color: '#CCF0D2',
                text: `${labels.mindmapIdea} 4`,
                frame: { x: 36, y: 508, w: 144, h: 86 },
              },
              // Right-top branch
              {
                type: 'shape',
                key: 'mm_b3',
                shape: 'rounded_rectangle',
                fill: '#FFF1F2',
                stroke: '#FB7185',
                strokeWidth: 2,
                text: `${labels.mindmapBranch} 3`,
                frame: { x: 750, y: 128, w: 170, h: 72 },
              },
              {
                type: 'sticky',
                key: 'mm_b3_a',
                color: '#FFD1D8',
                text: `${labels.mindmapIdea} 5`,
                frame: { x: 960, y: 80, w: 144, h: 86 },
              },
              {
                type: 'sticky',
                key: 'mm_b3_b',
                color: '#FFD1D8',
                text: `${labels.mindmapIdea} 6`,
                frame: { x: 960, y: 184, w: 144, h: 86 },
              },
              // Right-bottom branch
              {
                type: 'shape',
                key: 'mm_b4',
                shape: 'rounded_rectangle',
                fill: '#F5F3FF',
                stroke: '#A78BFA',
                strokeWidth: 2,
                text: `${labels.mindmapBranch} 4`,
                frame: { x: 750, y: 460, w: 170, h: 72 },
              },
              {
                type: 'sticky',
                key: 'mm_b4_a',
                color: '#E3D7FF',
                text: `${labels.mindmapIdea} 7`,
                frame: { x: 960, y: 404, w: 144, h: 86 },
              },
              {
                type: 'sticky',
                key: 'mm_b4_b',
                color: '#E3D7FF',
                text: `${labels.mindmapIdea} 8`,
                frame: { x: 960, y: 508, w: 144, h: 86 },
              },
              // Connectors
              {
                type: 'connector',
                key: 'mc1',
                from: { key: 'mm_center', anchorX: 0, anchorY: 0.5 },
                to: { key: 'mm_b1', anchorX: 1, anchorY: 0.5 },
                routing: 'curved',
                endHead: 'none',
                color: '#2563EB',
                strokeWidth: 2.5,
              },
              {
                type: 'connector',
                key: 'mc2',
                from: { key: 'mm_center', anchorX: 0, anchorY: 0.5 },
                to: { key: 'mm_b2', anchorX: 1, anchorY: 0.5 },
                routing: 'curved',
                endHead: 'none',
                color: '#16A34A',
                strokeWidth: 2.5,
              },
              {
                type: 'connector',
                key: 'mc3',
                from: { key: 'mm_center', anchorX: 1, anchorY: 0.5 },
                to: { key: 'mm_b3', anchorX: 0, anchorY: 0.5 },
                routing: 'curved',
                endHead: 'none',
                color: '#E11D48',
                strokeWidth: 2.5,
              },
              {
                type: 'connector',
                key: 'mc4',
                from: { key: 'mm_center', anchorX: 1, anchorY: 0.5 },
                to: { key: 'mm_b4', anchorX: 0, anchorY: 0.5 },
                routing: 'curved',
                endHead: 'none',
                color: '#7C3AED',
                strokeWidth: 2.5,
              },
              {
                type: 'connector',
                key: 'mc1a',
                from: { key: 'mm_b1', anchorX: 0, anchorY: 0.5 },
                to: { key: 'mm_b1_a', anchorX: 1, anchorY: 0.5 },
                routing: 'curved',
                endHead: 'none',
                color: '#2563EB',
              },
              {
                type: 'connector',
                key: 'mc1b',
                from: { key: 'mm_b1', anchorX: 0, anchorY: 0.5 },
                to: { key: 'mm_b1_b', anchorX: 1, anchorY: 0.5 },
                routing: 'curved',
                endHead: 'none',
                color: '#2563EB',
              },
              {
                type: 'connector',
                key: 'mc2a',
                from: { key: 'mm_b2', anchorX: 0, anchorY: 0.5 },
                to: { key: 'mm_b2_a', anchorX: 1, anchorY: 0.5 },
                routing: 'curved',
                endHead: 'none',
                color: '#16A34A',
              },
              {
                type: 'connector',
                key: 'mc2b',
                from: { key: 'mm_b2', anchorX: 0, anchorY: 0.5 },
                to: { key: 'mm_b2_b', anchorX: 1, anchorY: 0.5 },
                routing: 'curved',
                endHead: 'none',
                color: '#16A34A',
              },
              {
                type: 'connector',
                key: 'mc3a',
                from: { key: 'mm_b3', anchorX: 1, anchorY: 0.5 },
                to: { key: 'mm_b3_a', anchorX: 0, anchorY: 0.5 },
                routing: 'curved',
                endHead: 'none',
                color: '#E11D48',
              },
              {
                type: 'connector',
                key: 'mc3b',
                from: { key: 'mm_b3', anchorX: 1, anchorY: 0.5 },
                to: { key: 'mm_b3_b', anchorX: 0, anchorY: 0.5 },
                routing: 'curved',
                endHead: 'none',
                color: '#E11D48',
              },
              {
                type: 'connector',
                key: 'mc4a',
                from: { key: 'mm_b4', anchorX: 1, anchorY: 0.5 },
                to: { key: 'mm_b4_a', anchorX: 0, anchorY: 0.5 },
                routing: 'curved',
                endHead: 'none',
                color: '#7C3AED',
              },
              {
                type: 'connector',
                key: 'mc4b',
                from: { key: 'mm_b4', anchorX: 1, anchorY: 0.5 },
                to: { key: 'mm_b4_b', anchorX: 0, anchorY: 0.5 },
                routing: 'curved',
                endHead: 'none',
                color: '#7C3AED',
              },
            ],
          },
        ],
      }

    case 'user_journey': {
      const stages = [
        { k: 's1', name: labels.journeyAwareness, fill: '#EEF6FF', stroke: '#60A5FA' },
        { k: 's2', name: labels.journeyConsider, fill: '#F5F3FF', stroke: '#A78BFA' },
        { k: 's3', name: labels.journeyDecision, fill: '#FFFBEB', stroke: '#F59E0B' },
        { k: 's4', name: labels.journeyUse, fill: '#ECFDF3', stroke: '#34D399' },
        { k: 's5', name: labels.journeyAdvocate, fill: '#FFF1F2', stroke: '#FB7185' },
      ]
      const rows = [
        { k: 'act', label: labels.journeyActions, noteColor: '#FFF3A1', y: 204 },
        { k: 'tp', label: labels.journeyTouchpoint, noteColor: '#CBE4FF', y: 364 },
        { k: 'opp', label: labels.journeyOpportunity, noteColor: '#CCF0D2', y: 524 },
      ]
      const blocks: Array<Record<string, unknown>> = [
        {
          type: 'sticker',
          key: 'uj_ico',
          stickerId: 'rocket',
          frame: { x: 48, y: 26, w: 46, h: 46 },
        },
        {
          type: 'title',
          key: 'hdr',
          text: labels.title,
          fontSize: 30,
          frame: { x: 106, y: 32, w: 520, h: 44 },
        },
      ]
      // Row labels on the left
      for (const r of rows) {
        blocks.push({
          type: 'shape',
          key: `row_${r.k}`,
          shape: 'rounded_rectangle',
          fill: '#F7F5F0',
          stroke: '#C7C0B3',
          strokeWidth: 1.5,
          text: r.label,
          fontSize: 15,
          frame: { x: 48, y: r.y, w: 152, h: 136 },
        })
      }
      // 5 stage columns
      stages.forEach((st, idx) => {
        const colX = 220 + idx * 212
        blocks.push({
          type: 'shape',
          key: `stage_${st.k}`,
          shape: 'rounded_rectangle',
          fill: st.fill,
          stroke: st.stroke,
          strokeWidth: 2,
          text: `${idx + 1}. ${st.name}`,
          fontSize: 16,
          frame: { x: colX, y: 112, w: 192, h: 68 },
        })
        if (idx > 0) {
          blocks.push({
            type: 'connector',
            key: `stage_c_${idx}`,
            from: { key: `stage_${stages[idx - 1]!.k}`, anchorX: 1, anchorY: 0.5 },
            to: { key: `stage_${st.k}`, anchorX: 0, anchorY: 0.5 },
            routing: 'straight',
            color: '#475569',
          })
        }
        for (const r of rows) {
          blocks.push({
            type: 'sticky',
            key: `cell_${st.k}_${r.k}`,
            color: r.noteColor,
            text: labels.sampleItem,
            frame: { x: colX + 4, y: r.y + 4, w: 184, h: 128 },
          })
        }
      })
      return {
        schemaVersion: 1,
        target,
        pages: [{ key: 'user_journey', title: labels.title, format: 'freeform', blocks }],
      }
    }

    case 'meeting_notes':
      return {
        schemaVersion: 1,
        target,
        pages: [
          {
            key: 'meeting_notes',
            title: labels.title,
            format: 'freeform',
            blocks: [
              {
                type: 'sticker',
                key: 'mt_ico',
                stickerId: 'speech',
                frame: { x: 48, y: 26, w: 46, h: 46 },
              },
              {
                type: 'title',
                key: 'hdr',
                text: labels.title,
                fontSize: 30,
                frame: { x: 106, y: 32, w: 540, h: 44 },
              },
              {
                type: 'text',
                key: 'mt_meta',
                text: labels.meetingMeta,
                fontSize: 15,
                fill: '#F7F5F0',
                stroke: '#CBD5E1',
                frame: { x: 48, y: 92, w: 1004, h: 46 },
              },
              // Left column: Agenda & Notes
              {
                type: 'shape',
                key: 'mt_agenda_box',
                shape: 'rounded_rectangle',
                fill: '#EEF6FF',
                stroke: '#60A5FA',
                strokeWidth: 1.5,
                frame: { x: 48, y: 160, w: 472, h: 336 },
              },
              {
                type: 'text',
                key: 'mt_agenda_lbl',
                text: labels.meetingAgenda,
                fontSize: 16,
                fill: '#FFFFFF',
                stroke: '#60A5FA',
                align: 'center',
                frame: { x: 68, y: 174, w: 220, h: 46 },
              },
              {
                type: 'sticky',
                key: 'mt_note_1',
                color: '#FFF3A1',
                text: `${labels.sampleItem} 1`,
                frame: { x: 72, y: 234, w: 200, h: 112 },
              },
              {
                type: 'sticky',
                key: 'mt_note_2',
                color: '#CBE4FF',
                text: `${labels.sampleItem} 2`,
                frame: { x: 294, y: 234, w: 200, h: 112 },
              },
              {
                type: 'sticky',
                key: 'mt_note_3',
                color: '#E3D7FF',
                text: `${labels.sampleItem} 3`,
                frame: { x: 72, y: 364, w: 200, h: 112 },
              },
              // Bottom-left: Decisions
              {
                type: 'shape',
                key: 'mt_dec_box',
                shape: 'rounded_rectangle',
                fill: '#ECFDF3',
                stroke: '#34D399',
                strokeWidth: 1.5,
                frame: { x: 48, y: 520, w: 472, h: 172 },
              },
              {
                type: 'text',
                key: 'mt_dec_lbl',
                text: labels.meetingDecisions,
                fontSize: 16,
                fill: '#FFFFFF',
                stroke: '#34D399',
                align: 'center',
                frame: { x: 68, y: 534, w: 220, h: 46 },
              },
              {
                type: 'sticker',
                key: 'mt_dec_ico',
                stickerId: 'check',
                frame: { x: 468, y: 528, w: 38, h: 38 },
              },
              {
                type: 'sticky',
                key: 'mt_dec_1',
                color: '#CCF0D2',
                text: labels.sampleItem,
                frame: { x: 72, y: 594, w: 422, h: 82 },
              },
              // Right column: Action Items Table
              {
                type: 'text',
                key: 'mt_act_lbl',
                text: labels.meetingActions,
                fontSize: 18,
                frame: { x: 548, y: 160, w: 320, h: 34 },
              },
              {
                type: 'table',
                key: 'mt_table',
                rows: 5,
                cols: 4,
                headerRow: true,
                fontSize: 14,
                data: [
                  [
                    labels.meetingColTask,
                    labels.meetingColOwner,
                    labels.meetingColDue,
                    labels.meetingColStatus,
                  ],
                  [`${labels.sampleItem} 1`, '', '', ''],
                  [`${labels.sampleItem} 2`, '', '', ''],
                  [`${labels.sampleItem} 3`, '', '', ''],
                  ['', '', '', ''],
                ],
                frame: { x: 548, y: 204, w: 504, h: 488 },
              },
            ],
          },
        ],
      }

    case 'bmc':
      return {
        schemaVersion: 1,
        target,
        pages: [
          {
            key: 'bmc',
            title: labels.title,
            format: 'freeform',
            blocks: [
              {
                type: 'sticker',
                key: 'bmc_ico',
                stickerId: 'trophy',
                frame: { x: 48, y: 26, w: 46, h: 46 },
              },
              {
                type: 'title',
                key: 'hdr',
                text: labels.title,
                fontSize: 30,
                frame: { x: 106, y: 32, w: 560, h: 44 },
              },
              // Col 1: Key Partners (tall)
              {
                type: 'shape',
                key: 'bmc_kp',
                shape: 'rounded_rectangle',
                fill: '#F7F5F0',
                stroke: '#CBD5E1',
                strokeWidth: 1.5,
                frame: { x: 48, y: 100, w: 204, h: 432 },
              },
              {
                type: 'text',
                key: 'bmc_kp_t',
                text: labels.bmcPartners,
                fontSize: 14,
                fill: '#FFFFFF',
                stroke: '#CBD5E1',
                align: 'center',
                frame: { x: 60, y: 112, w: 180, h: 44 },
              },
              {
                type: 'sticky',
                key: 'bmc_kp_n',
                color: '#FFF3A1',
                text: labels.sampleItem,
                frame: { x: 64, y: 170, w: 172, h: 124 },
              },
              // Col 2 top: Key Activities
              {
                type: 'shape',
                key: 'bmc_ka',
                shape: 'rounded_rectangle',
                fill: '#EEF6FF',
                stroke: '#60A5FA',
                strokeWidth: 1.5,
                frame: { x: 264, y: 100, w: 204, h: 210 },
              },
              {
                type: 'text',
                key: 'bmc_ka_t',
                text: labels.bmcActivities,
                fontSize: 14,
                fill: '#FFFFFF',
                stroke: '#60A5FA',
                align: 'center',
                frame: { x: 276, y: 112, w: 180, h: 44 },
              },
              {
                type: 'sticky',
                key: 'bmc_ka_n',
                color: '#CBE4FF',
                text: labels.sampleItem,
                frame: { x: 280, y: 168, w: 172, h: 126 },
              },
              // Col 2 bottom: Key Resources
              {
                type: 'shape',
                key: 'bmc_kr',
                shape: 'rounded_rectangle',
                fill: '#EEF6FF',
                stroke: '#60A5FA',
                strokeWidth: 1.5,
                frame: { x: 264, y: 322, w: 204, h: 210 },
              },
              {
                type: 'text',
                key: 'bmc_kr_t',
                text: labels.bmcResources,
                fontSize: 14,
                fill: '#FFFFFF',
                stroke: '#60A5FA',
                align: 'center',
                frame: { x: 276, y: 334, w: 180, h: 44 },
              },
              {
                type: 'sticky',
                key: 'bmc_kr_n',
                color: '#CBE4FF',
                text: labels.sampleItem,
                frame: { x: 280, y: 390, w: 172, h: 126 },
              },
              // Col 3: Value Propositions (tall highlight)
              {
                type: 'shape',
                key: 'bmc_vp',
                shape: 'rounded_rectangle',
                fill: '#FFFBEB',
                stroke: '#F59E0B',
                strokeWidth: 2,
                frame: { x: 480, y: 100, w: 216, h: 432 },
              },
              {
                type: 'text',
                key: 'bmc_vp_t',
                text: labels.bmcValue,
                fontSize: 14,
                fill: '#FFFFFF',
                stroke: '#F59E0B',
                align: 'center',
                frame: { x: 492, y: 112, w: 192, h: 44 },
              },
              {
                type: 'sticky',
                key: 'bmc_vp_n',
                color: '#FFDAB3',
                text: labels.sampleItem,
                frame: { x: 498, y: 170, w: 180, h: 140 },
              },
              // Col 4 top: Customer Relationships
              {
                type: 'shape',
                key: 'bmc_cr',
                shape: 'rounded_rectangle',
                fill: '#F5F3FF',
                stroke: '#A78BFA',
                strokeWidth: 1.5,
                frame: { x: 708, y: 100, w: 204, h: 210 },
              },
              {
                type: 'text',
                key: 'bmc_cr_t',
                text: labels.bmcRelations,
                fontSize: 14,
                fill: '#FFFFFF',
                stroke: '#A78BFA',
                align: 'center',
                frame: { x: 720, y: 112, w: 180, h: 44 },
              },
              {
                type: 'sticky',
                key: 'bmc_cr_n',
                color: '#E3D7FF',
                text: labels.sampleItem,
                frame: { x: 724, y: 168, w: 172, h: 126 },
              },
              // Col 4 bottom: Channels
              {
                type: 'shape',
                key: 'bmc_ch',
                shape: 'rounded_rectangle',
                fill: '#F5F3FF',
                stroke: '#A78BFA',
                strokeWidth: 1.5,
                frame: { x: 708, y: 322, w: 204, h: 210 },
              },
              {
                type: 'text',
                key: 'bmc_ch_t',
                text: labels.bmcChannels,
                fontSize: 14,
                fill: '#FFFFFF',
                stroke: '#A78BFA',
                align: 'center',
                frame: { x: 720, y: 334, w: 180, h: 44 },
              },
              {
                type: 'sticky',
                key: 'bmc_ch_n',
                color: '#E3D7FF',
                text: labels.sampleItem,
                frame: { x: 724, y: 390, w: 172, h: 126 },
              },
              // Col 5: Customer Segments (tall)
              {
                type: 'shape',
                key: 'bmc_cs',
                shape: 'rounded_rectangle',
                fill: '#ECFDF3',
                stroke: '#34D399',
                strokeWidth: 1.5,
                frame: { x: 924, y: 100, w: 204, h: 432 },
              },
              {
                type: 'text',
                key: 'bmc_cs_t',
                text: labels.bmcSegments,
                fontSize: 14,
                fill: '#FFFFFF',
                stroke: '#34D399',
                align: 'center',
                frame: { x: 936, y: 112, w: 180, h: 44 },
              },
              {
                type: 'sticky',
                key: 'bmc_cs_n',
                color: '#CCF0D2',
                text: labels.sampleItem,
                frame: { x: 940, y: 170, w: 172, h: 124 },
              },
              // Bottom-left: Cost Structure
              {
                type: 'shape',
                key: 'bmc_cost',
                shape: 'rounded_rectangle',
                fill: '#FFF1F2',
                stroke: '#FB7185',
                strokeWidth: 1.5,
                frame: { x: 48, y: 544, w: 534, h: 176 },
              },
              {
                type: 'text',
                key: 'bmc_cost_t',
                text: labels.bmcCost,
                fontSize: 14,
                fill: '#FFFFFF',
                stroke: '#FB7185',
                align: 'center',
                frame: { x: 64, y: 556, w: 190, h: 44 },
              },
              {
                type: 'sticky',
                key: 'bmc_cost_n',
                color: '#FFD1D8',
                text: labels.sampleItem,
                frame: { x: 64, y: 612, w: 220, h: 92 },
              },
              // Bottom-right: Revenue Streams
              {
                type: 'shape',
                key: 'bmc_rev',
                shape: 'rounded_rectangle',
                fill: '#ECFDF3',
                stroke: '#34D399',
                strokeWidth: 1.5,
                frame: { x: 594, y: 544, w: 534, h: 176 },
              },
              {
                type: 'text',
                key: 'bmc_rev_t',
                text: labels.bmcRevenue,
                fontSize: 14,
                fill: '#FFFFFF',
                stroke: '#34D399',
                align: 'center',
                frame: { x: 610, y: 556, w: 190, h: 44 },
              },
              {
                type: 'sticky',
                key: 'bmc_rev_n',
                color: '#CCF0D2',
                text: labels.sampleItem,
                frame: { x: 610, y: 612, w: 220, h: 92 },
              },
            ],
          },
        ],
      }

    case 'fishbone':
      return {
        schemaVersion: 1,
        target,
        pages: [
          {
            key: 'fishbone',
            title: labels.title,
            format: 'freeform',
            blocks: [
              {
                type: 'sticker',
                key: 'fb_ico',
                stickerId: 'fire',
                frame: { x: 48, y: 26, w: 46, h: 46 },
              },
              {
                type: 'title',
                key: 'hdr',
                text: labels.title,
                fontSize: 30,
                frame: { x: 106, y: 32, w: 540, h: 44 },
              },
              // Problem head on right
              {
                type: 'shape',
                key: 'fb_head',
                shape: 'rounded_rectangle',
                fill: '#FFF1F2',
                stroke: '#FB7185',
                strokeWidth: 2.5,
                text: labels.fishboneProblem,
                fontSize: 18,
                frame: { x: 860, y: 312, w: 210, h: 104 },
              },
              // Spine anchor left -> Problem head
              {
                type: 'connector',
                key: 'fb_spine',
                from: { x: 64, y: 364 },
                to: { key: 'fb_head', anchorX: 0, anchorY: 0.5 },
                routing: 'straight',
                strokeWidth: 3.5,
                color: '#1F1D1A',
              },
              // Top-left cause: People
              {
                type: 'shape',
                key: 'fb_c1',
                shape: 'rounded_rectangle',
                fill: '#EEF6FF',
                stroke: '#60A5FA',
                strokeWidth: 2,
                text: labels.fishbonePeople,
                frame: { x: 120, y: 112, w: 180, h: 56 },
              },
              {
                type: 'sticky',
                key: 'fb_c1_n',
                color: '#CBE4FF',
                text: `${labels.fishboneCause} 1`,
                frame: { x: 80, y: 196, w: 176, h: 106 },
              },
              {
                type: 'connector',
                key: 'fb_b1',
                from: { key: 'fb_c1', anchorX: 0.5, anchorY: 1 },
                to: { x: 320, y: 364 },
                routing: 'straight',
                endHead: 'none',
                color: '#2563EB',
                strokeWidth: 2,
              },
              // Top-right cause: Process
              {
                type: 'shape',
                key: 'fb_c2',
                shape: 'rounded_rectangle',
                fill: '#F5F3FF',
                stroke: '#A78BFA',
                strokeWidth: 2,
                text: labels.fishboneProcess,
                frame: { x: 470, y: 112, w: 180, h: 56 },
              },
              {
                type: 'sticky',
                key: 'fb_c2_n',
                color: '#E3D7FF',
                text: `${labels.fishboneCause} 2`,
                frame: { x: 430, y: 196, w: 176, h: 106 },
              },
              {
                type: 'connector',
                key: 'fb_b2',
                from: { key: 'fb_c2', anchorX: 0.5, anchorY: 1 },
                to: { x: 670, y: 364 },
                routing: 'straight',
                endHead: 'none',
                color: '#7C3AED',
                strokeWidth: 2,
              },
              // Bottom-left cause: Tools
              {
                type: 'shape',
                key: 'fb_c3',
                shape: 'rounded_rectangle',
                fill: '#FFFBEB',
                stroke: '#F59E0B',
                strokeWidth: 2,
                text: labels.fishboneTools,
                frame: { x: 120, y: 560, w: 180, h: 56 },
              },
              {
                type: 'sticky',
                key: 'fb_c3_n',
                color: '#FFF3A1',
                text: `${labels.fishboneCause} 3`,
                frame: { x: 80, y: 426, w: 176, h: 106 },
              },
              {
                type: 'connector',
                key: 'fb_b3',
                from: { key: 'fb_c3', anchorX: 0.5, anchorY: 0 },
                to: { x: 320, y: 364 },
                routing: 'straight',
                endHead: 'none',
                color: '#D97706',
                strokeWidth: 2,
              },
              // Bottom-right cause: Environment
              {
                type: 'shape',
                key: 'fb_c4',
                shape: 'rounded_rectangle',
                fill: '#ECFDF3',
                stroke: '#34D399',
                strokeWidth: 2,
                text: labels.fishboneEnv,
                frame: { x: 470, y: 560, w: 180, h: 56 },
              },
              {
                type: 'sticky',
                key: 'fb_c4_n',
                color: '#CCF0D2',
                text: `${labels.fishboneCause} 4`,
                frame: { x: 430, y: 426, w: 176, h: 106 },
              },
              {
                type: 'connector',
                key: 'fb_b4',
                from: { key: 'fb_c4', anchorX: 0.5, anchorY: 0 },
                to: { x: 670, y: 364 },
                routing: 'straight',
                endHead: 'none',
                color: '#16A34A',
                strokeWidth: 2,
              },
            ],
          },
        ],
      }

    case 'okr':
      return {
        schemaVersion: 1,
        target,
        pages: [
          {
            key: 'okr',
            title: labels.title,
            format: 'freeform',
            blocks: [
              {
                type: 'sticker',
                key: 'okr_ico',
                stickerId: 'flag',
                frame: { x: 48, y: 26, w: 46, h: 46 },
              },
              {
                type: 'title',
                key: 'hdr',
                text: labels.title,
                fontSize: 30,
                frame: { x: 106, y: 32, w: 540, h: 44 },
              },
              // Top Objective Banner
              {
                type: 'shape',
                key: 'okr_obj',
                shape: 'rounded_rectangle',
                fill: '#FFFBEB',
                stroke: '#F59E0B',
                strokeWidth: 2.2,
                text: labels.okrObjective,
                fontSize: 18,
                frame: { x: 248, y: 98, w: 560, h: 80 },
              },
              // 3 Key Results
              {
                type: 'shape',
                key: 'kr1',
                shape: 'rounded_rectangle',
                fill: '#EEF6FF',
                stroke: '#60A5FA',
                strokeWidth: 1.8,
                text: `${labels.okrKr} 1`,
                frame: { x: 56, y: 232, w: 288, h: 84 },
              },
              {
                type: 'shape',
                key: 'kr2',
                shape: 'rounded_rectangle',
                fill: '#F5F3FF',
                stroke: '#A78BFA',
                strokeWidth: 1.8,
                text: `${labels.okrKr} 2`,
                frame: { x: 384, y: 232, w: 288, h: 84 },
              },
              {
                type: 'shape',
                key: 'kr3',
                shape: 'rounded_rectangle',
                fill: '#ECFDF3',
                stroke: '#34D399',
                strokeWidth: 1.8,
                text: `${labels.okrKr} 3`,
                frame: { x: 712, y: 232, w: 288, h: 84 },
              },
              {
                type: 'sticker',
                key: 'okr_s1',
                stickerId: 'one',
                frame: { x: 44, y: 218, w: 36, h: 36 },
              },
              {
                type: 'sticker',
                key: 'okr_s2',
                stickerId: 'two',
                frame: { x: 372, y: 218, w: 36, h: 36 },
              },
              {
                type: 'sticker',
                key: 'okr_s3',
                stickerId: 'three',
                frame: { x: 700, y: 218, w: 36, h: 36 },
              },
              {
                type: 'connector',
                key: 'oc1',
                from: { key: 'okr_obj', anchorX: 0.5, anchorY: 1 },
                to: { key: 'kr1', anchorX: 0.5, anchorY: 0 },
                routing: 'curved',
                color: '#475569',
              },
              {
                type: 'connector',
                key: 'oc2',
                from: { key: 'okr_obj', anchorX: 0.5, anchorY: 1 },
                to: { key: 'kr2', anchorX: 0.5, anchorY: 0 },
                routing: 'straight',
                color: '#475569',
              },
              {
                type: 'connector',
                key: 'oc3',
                from: { key: 'okr_obj', anchorX: 0.5, anchorY: 1 },
                to: { key: 'kr3', anchorX: 0.5, anchorY: 0 },
                routing: 'curved',
                color: '#475569',
              },
              // Initiatives
              {
                type: 'sticky',
                key: 'init1',
                color: '#CBE4FF',
                text: `${labels.okrInitiative} 1`,
                frame: { x: 76, y: 340, w: 248, h: 108 },
              },
              {
                type: 'sticky',
                key: 'init2',
                color: '#E3D7FF',
                text: `${labels.okrInitiative} 2`,
                frame: { x: 404, y: 340, w: 248, h: 108 },
              },
              {
                type: 'sticky',
                key: 'init3',
                color: '#CCF0D2',
                text: `${labels.okrInitiative} 3`,
                frame: { x: 732, y: 340, w: 248, h: 108 },
              },
              // KPI Table
              {
                type: 'table',
                key: 'okr_table',
                rows: 4,
                cols: 4,
                headerRow: true,
                fontSize: 14,
                data: [
                  [
                    labels.okrColMetric,
                    labels.okrColTarget,
                    labels.okrColCurrent,
                    labels.meetingColStatus,
                  ],
                  [`${labels.okrKr} 1`, '100%', '0%', ''],
                  [`${labels.okrKr} 2`, '100%', '0%', ''],
                  [`${labels.okrKr} 3`, '100%', '0%', ''],
                ],
                frame: { x: 56, y: 476, w: 944, h: 196 },
              },
            ],
          },
        ],
      }
  }
}
