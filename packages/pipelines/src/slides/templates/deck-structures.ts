/**
 * Purpose-specific slide deck structures orthogonal to the 12 visual styles
 * in `SLIDE_TEMPLATES` (T11). Selecting a structure guides slide flow without
 * changing the default system prompt when no structure is chosen.
 */

export type SlideDeckStructureId = 'weekly-report' | 'proposal' | 'lecture' | 'product-overview'

export interface SlideDeckStructureSlot {
  readonly role: string
  readonly guidance: string
}

export interface SlideDeckStructure {
  readonly id: SlideDeckStructureId
  readonly titleKo: string
  readonly titleEn: string
  readonly summaryKo: string
  readonly summaryEn: string
  readonly recommendedSlides: number
  readonly slots: readonly SlideDeckStructureSlot[]
}

export const SLIDE_DECK_STRUCTURES: readonly SlideDeckStructure[] = [
  {
    id: 'weekly-report',
    titleKo: '주간 보고',
    titleEn: 'Weekly Report',
    summaryKo: '핵심 요약 → 주요 지표 → 완료 업무 → 이슈·리스크 → 다음 주 계획',
    summaryEn: 'Headline summary → KPIs → Completed work → Risks/blockers → Next week plan',
    recommendedSlides: 6,
    slots: [
      { role: 'Cover', guidance: 'Report title, period, team name, one-line takeaway.' },
      { role: 'Executive Summary', guidance: 'Three headline bullets and overall status.' },
      { role: 'Key Metrics', guidance: '3-4 comparable metrics with period-over-period delta.' },
      { role: 'Completed Work', guidance: 'Concrete deliverables completed this period.' },
      { role: 'Risks & Decisions', guidance: 'Blockers, owner, mitigation, and decisions needed.' },
      { role: 'Next Week Plan', guidance: 'Top priorities with owners and target dates.' },
    ],
  },
  {
    id: 'proposal',
    titleKo: '제안서',
    titleEn: 'Proposal',
    summaryKo: '배경·문제 → 제안 해법 → 실행 계획 → 기대 효과 → 일정·예산 → 의사결정 요청',
    summaryEn:
      'Context/problem → Proposed approach → Execution → Impact → Timeline/budget → Decision ask',
    recommendedSlides: 8,
    slots: [
      { role: 'Cover', guidance: 'Proposal title, audience, date.' },
      { role: 'Problem & Opportunity', guidance: 'Why act now, supported by grounded facts.' },
      { role: 'Proposed Solution', guidance: 'Core approach and key differentiating choices.' },
      { role: 'Architecture / Workflow', guidance: 'How the solution operates step by step.' },
      { role: 'Expected Impact', guidance: 'Measurable outcomes and qualitative benefits.' },
      { role: 'Roadmap & Milestones', guidance: 'Phased schedule with deliverables.' },
      { role: 'Resources & Risk', guidance: 'Required budget/staffing and risk mitigation.' },
      { role: 'Decision Ask', guidance: 'Exact approval needed and immediate next step.' },
    ],
  },
  {
    id: 'lecture',
    titleKo: '강의안',
    titleEn: 'Lecture / Workshop',
    summaryKo: '학습 목표 → 핵심 개념 → 단계별 설명 → 사례·실습 → 핵심 정리',
    summaryEn:
      'Learning goals → Core concept → Step-by-step walkthrough → Example/exercise → Recap',
    recommendedSlides: 7,
    slots: [
      { role: 'Cover', guidance: 'Session title, instructor, audience level.' },
      { role: 'Learning Objectives', guidance: '2-3 skills or concepts learners will master.' },
      { role: 'Big Picture', guidance: 'Mental model or visual map of the topic.' },
      { role: 'Core Concept 1', guidance: 'Clear explanation with one concrete example.' },
      { role: 'Core Concept 2', guidance: 'Contrast, edge cases, or deeper technique.' },
      { role: 'Guided Practice', guidance: 'Hands-on prompt or worked walkthrough.' },
      { role: 'Summary & Takeaways', guidance: 'Three memorable rules and further reading.' },
    ],
  },
  {
    id: 'product-overview',
    titleKo: '제품 소개',
    titleEn: 'Product Overview',
    summaryKo: '가치 제안 → 고객 과제 → 핵심 기능 → 작동 방식 → 활용 사례 → 시작 안내',
    summaryEn:
      'Value proposition → Customer pain → Core capabilities → How it works → Use cases → Getting started',
    recommendedSlides: 7,
    slots: [
      { role: 'Cover', guidance: 'Product name and single-sentence value statement.' },
      { role: 'The Challenge', guidance: 'Everyday pain point users face today.' },
      { role: 'Core Capabilities', guidance: 'Three focused pillars solving that challenge.' },
      { role: 'How It Works', guidance: 'Simple 3-step user journey.' },
      { role: 'Use Cases', guidance: 'Representative real-world workflows.' },
      { role: 'Trust & Readiness', guidance: 'Security, compatibility, or deployment readiness.' },
      { role: 'Next Steps', guidance: 'How to try, adopt, or contact the team.' },
    ],
  },
]

export function listSlideDeckStructures(): readonly SlideDeckStructure[] {
  return SLIDE_DECK_STRUCTURES
}

export function findSlideDeckStructure(
  id: SlideDeckStructureId | string,
): SlideDeckStructure | undefined {
  const key = String(id ?? '')
    .trim()
    .toLowerCase()
  if (!key) return undefined
  return SLIDE_DECK_STRUCTURES.find((s) => s.id === key)
}

export function formatDeckStructurePromptNote(structure: SlideDeckStructure | undefined): string {
  if (!structure) return ''
  const lines = structure.slots.map((s, idx) => `${idx + 1}. ${s.role}: ${s.guidance}`)
  return `Deck structure (${structure.titleEn}, target ~${structure.recommendedSlides} slides):\n${lines.join('\n')}`
}
