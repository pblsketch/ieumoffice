/**
 * Five offline one-page practical HTML document templates (T11).
 * 100% self-contained with @page print rules and zero external URLs or CDNs.
 */

export type PracticalHtmlTemplateId =
  'meeting-minutes' | 'project-prd' | 'performance-summary' | 'team-okr' | 'quote-invoice'

export interface PracticalHtmlTemplate {
  readonly id: PracticalHtmlTemplateId
  readonly titleKo: string
  readonly titleEn: string
  readonly summaryKo: string
  readonly summaryEn: string
  readonly html: string
}

const SHARED_BASE_STYLE = `@page { size: A4 portrait; margin: 16mm; }
:root {
  --ink: #18181b;
  --ink-strong: #111827;
  --ink-muted: #4b5563;
  --ink-subtle: #52525b;
  --ink-soft: #3f3f46;
  --accent: #1e3a5f;
  --bg: #ffffff;
  --surface: #fafafa;
  --surface-alt: #f4f4f5;
  --callout-bg: #f8fafc;
  --border: #d4d4d8;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 28px 32px;
  font-family: "Pretendard", "Noto Sans KR", "Malgun Gothic", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: var(--ink);
  background: var(--bg);
  font-size: 10.5pt;
  line-height: 1.6;
  word-break: keep-all;
}
.sheet { max-width: 780px; margin: 0 auto; }
header { border-bottom: 2px solid var(--accent); padding-bottom: 12px; margin-bottom: 18px; }
h1 { margin: 0 0 6px; font-size: 20pt; line-height: 1.25; color: var(--ink-strong); }
.subtitle { margin: 0; color: var(--ink-muted); font-size: 10pt; }
h2 { margin: 18px 0 8px; font-size: 12pt; color: var(--accent); break-after: avoid; }
p { margin: 0 0 8px; }
ul { margin: 6px 0 12px; padding-left: 18px; }
li { margin: 4px 0; }
table { width: 100%; border-collapse: collapse; margin: 10px 0 14px; font-size: 9.5pt; break-inside: avoid; }
th, td { border: 1px solid var(--border); padding: 7px 9px; text-align: left; vertical-align: top; }
th { background: var(--surface-alt); font-weight: 600; color: var(--ink); }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 16px; font-size: 9.5pt; color: var(--ink-soft); margin-top: 8px; }
.kpi-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 12px 0 16px; }
.kpi { border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; background: var(--surface); break-inside: avoid; }
.kpi-label { font-size: 8.5pt; color: var(--ink-subtle); }
.kpi-value { font-size: 16pt; font-weight: 700; color: var(--accent); margin-top: 2px; }
.callout { border-left: 3px solid var(--accent); background: var(--callout-bg); padding: 10px 12px; margin: 12px 0; break-inside: avoid; }`

function wrapHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
${SHARED_BASE_STYLE}
  </style>
</head>
<body>
  <main class="sheet">
${body}
  </main>
</body>
</html>`
}

export const PRACTICAL_HTML_TEMPLATES: readonly PracticalHtmlTemplate[] = [
  {
    id: 'meeting-minutes',
    titleKo: '회의록 (1페이지)',
    titleEn: 'Meeting Minutes (1-Page)',
    summaryKo: '일시·참석자·안건·결정 사항·후속 조치 표를 한 장에 정리합니다.',
    summaryEn: 'Captures date, attendees, agenda, decisions, and action items on one page.',
    html: wrapHtml(
      '주간 제품 회의록',
      `    <header>
      <h1>주간 제품 점검 회의록</h1>
      <p class="subtitle">핵심 결론: 2분기 배포 범위를 확정하고 담당자별 마감 일정을 합의했습니다.</p>
      <div class="meta-grid">
        <div><strong>일시:</strong> 2026-04-15 10:00 – 10:50</div>
        <div><strong>장소:</strong> 본사 4층 중회의실</div>
        <div><strong>참석자:</strong> 기획팀, 개발팀, 디자인팀</div>
        <div><strong>작성자:</strong> 운영 담당자</div>
      </div>
    </header>
    <section>
      <h2>1. 논의 안건 및 결정 사항</h2>
      <ul>
        <li><strong>안건 1 — 문서 템플릿 개편:</strong> 오프라인 1페이지 기본 양식 5종을 우선 제공합니다.</li>
        <li><strong>안건 2 — 인쇄 여백 기준:</strong> A4 세로 16mm 여백을 공통 기본값으로 적용합니다.</li>
        <li><strong>안건 3 — 검토 메모 처리:</strong> 원 메모를 유지한 채 답글로 반영 결과를 기록합니다.</li>
      </ul>
    </section>
    <section>
      <h2>2. 후속 조치 (Action Items)</h2>
      <table>
        <thead>
          <tr><th>업무 항목</th><th>담당</th><th>마감일</th><th>상태</th></tr>
        </thead>
        <tbody>
          <tr><td>템플릿 시안 최종 검수</td><td>디자인팀</td><td>2026-04-18</td><td>진행 중</td></tr>
          <tr><td>인쇄 미리보기 회귀 점검</td><td>개발팀</td><td>2026-04-21</td><td>예정</td></tr>
          <tr><td>사용자 안내 문구 확정</td><td>기획팀</td><td>2026-04-22</td><td>예정</td></tr>
        </tbody>
      </table>
    </section>`,
    ),
  },
  {
    id: 'project-prd',
    titleKo: '기획서 / PRD (1페이지)',
    titleEn: 'Product Spec / PRD (1-Page)',
    summaryKo: '문제 정의·목표·핵심 요구사항·범위 외·일정을 한눈에 정리합니다.',
    summaryEn: 'Summarizes problem, goals, requirements, non-goals, and milestones.',
    html: wrapHtml(
      '기능 기획서 (PRD)',
      `    <header>
      <h1>문서 품질 자동 점검 기능 기획서</h1>
      <p class="subtitle">목표: 작성 직후 레이아웃·자리표시자 오류를 자동으로 찾아 재작업 시간을 줄입니다.</p>
      <div class="meta-grid">
        <div><strong>문서 상태:</strong> 검토 요청</div>
        <div><strong>대상 배포:</strong> 2026년 2분기</div>
      </div>
    </header>
    <section class="callout">
      <strong>핵심 문제:</strong> 초안 완성 후 인쇄·발표 단계에서 쪽 넘침과 미완성 문구가 뒤늦게 발견됩니다.
    </section>
    <section>
      <h2>1. 핵심 요구사항</h2>
      <table>
        <thead>
          <tr><th>구분</th><th>요구사항</th><th>우선순위</th></tr>
        </thead>
        <tbody>
          <tr><td>정적 점검</td><td>자리표시자·바닥글 침범·쪽 넘침을 자동 탐지합니다.</td><td>필수</td></tr>
          <tr><td>비차단 안내</td><td>경고 배지를 표시하되 저장·인쇄를 막지 않습니다.</td><td>필수</td></tr>
          <tr><td>수동 보정</td><td>네트워크 없이 스타일과 여백을 즉시 조절합니다.</td><td>권장</td></tr>
        </tbody>
      </table>
    </section>
    <section>
      <h2>2. 범위 외 (Non-Goals)</h2>
      <ul>
        <li>외부 클라우드 서버에 문서를 업로드해 검사하는 기능은 포함하지 않습니다.</li>
      </ul>
    </section>`,
    ),
  },
  {
    id: 'performance-summary',
    titleKo: '실적 요약 보고서 (1페이지)',
    titleEn: 'Performance Summary Report (1-Page)',
    summaryKo: '핵심 지표 카드, 부문별 실적 표, 주요 성과와 다음 달 계획을 담습니다.',
    summaryEn: 'Highlights headline metrics, breakdown table, wins, and next priorities.',
    html: wrapHtml(
      '분기 실적 요약 보고서',
      `    <header>
      <h1>2026년 1분기 운영 실적 요약</h1>
      <p class="subtitle">요약: 전체 처리 건수가 전분기 대비 증가했으며 평균 처리 시간이 단축되었습니다.</p>
    </header>
    <section class="kpi-row">
      <div class="kpi"><div class="kpi-label">총 처리 건수</div><div class="kpi-value">1,240건</div></div>
      <div class="kpi"><div class="kpi-label">기한 준수율</div><div class="kpi-value">96.4%</div></div>
      <div class="kpi"><div class="kpi-label">평균 소요 시간</div><div class="kpi-value">1.8일</div></div>
    </section>
    <section>
      <h2>1. 부문별 세부 실적</h2>
      <table>
        <thead>
          <tr><th>부문</th><th class="num">목표</th><th class="num">실적</th><th class="num">달성률</th></tr>
        </thead>
        <tbody>
          <tr><td>문서 제작 지원</td><td class="num">500건</td><td class="num">528건</td><td class="num">105.6%</td></tr>
          <tr><td>품질 검토</td><td class="num">420건</td><td class="num">412건</td><td class="num">98.1%</td></tr>
          <tr><td>교육·온보딩</td><td class="num">280건</td><td class="num">300건</td><td class="num">107.1%</td></tr>
        </tbody>
      </table>
    </section>
    <section>
      <h2>2. 다음 분기 중점 계획</h2>
      <ul>
        <li>반복 문의가 많은 서식을 기본 템플릿으로 표준화합니다.</li>
        <li>월간 정기 점검 주기를 격주 단위로 단축합니다.</li>
      </ul>
    </section>`,
    ),
  },
  {
    id: 'team-okr',
    titleKo: '팀 목표 · OKR (1페이지)',
    titleEn: 'Team Goals & OKR (1-Page)',
    summaryKo: '분기 목표(Objective)와 측정 가능한 핵심 결과(KR), 진행률을 정리합니다.',
    summaryEn: 'Organizes quarterly Objectives, measurable Key Results, and progress.',
    html: wrapHtml(
      '분기 팀 OKR',
      `    <header>
      <h1>2026년 2분기 팀 OKR</h1>
      <p class="subtitle">초점: 문서 작성 완결성과 일상 협업 속도를 동시에 끌어올립니다.</p>
    </header>
    <section>
      <h2>목표 1: 첫 초안에서 최종본까지의 수정 단계를 절반으로 줄인다</h2>
      <table>
        <thead>
          <tr><th>핵심 결과 (KR)</th><th>담당</th><th class="num">목표치</th><th class="num">현재</th></tr>
        </thead>
        <tbody>
          <tr><td>KR1. 기본 실무 템플릿 활용 비중 확대</td><td>기획팀</td><td class="num">60%</td><td class="num">25%</td></tr>
          <tr><td>KR2. 인쇄 넘침 재작업 건수 감소</td><td>품질팀</td><td class="num">10건 이하</td><td class="num">24건</td></tr>
        </tbody>
      </table>
    </section>
    <section>
      <h2>목표 2: 팀 검토 메모 처리 누락을 0건으로 유지한다</h2>
      <table>
        <thead>
          <tr><th>핵심 결과 (KR)</th><th>담당</th><th class="num">목표치</th><th class="num">현재</th></tr>
        </thead>
        <tbody>
          <tr><td>KR1. 검토 메모 답글 기록률</td><td>전체</td><td class="num">100%</td><td class="num">72%</td></tr>
          <tr><td>KR2. 주요 문서 주간 점검 완료율</td><td>운영팀</td><td class="num">100%</td><td class="num">85%</td></tr>
        </tbody>
      </table>
    </section>`,
    ),
  },
  {
    id: 'quote-invoice',
    titleKo: '견적서 / 청구서 (1페이지)',
    titleEn: 'Quote / Invoice (1-Page)',
    summaryKo: '공급자·수신자 정보, 품목 단가·수량·합계, 결제 조건을 깔끔하게 정리합니다.',
    summaryEn: 'Presents supplier/client details, line items, totals, and payment terms.',
    html: wrapHtml(
      '견적서',
      `    <header>
      <h1>견 적 서</h1>
      <p class="subtitle">문서 번호: QT-2026-0415 · 유효 기간: 발행일로부터 30일</p>
      <div class="meta-grid">
        <div><strong>수신:</strong> 가나다 주식회사 담당자 귀하</div>
        <div><strong>공급자:</strong> 예시 스튜디오 (사업자번호 000-00-00000)</div>
      </div>
    </header>
    <section>
      <h2>1. 견적 내역 (단위: 원, 부가세 별도)</h2>
      <table>
        <thead>
          <tr><th>항목</th><th>규격 / 내용</th><th class="num">수량</th><th class="num">단가</th><th class="num">금액</th></tr>
        </thead>
        <tbody>
          <tr><td>문서 템플릿 설계</td><td>인쇄·화면 겸용 5종</td><td class="num">5</td><td class="num">300,000</td><td class="num">1,500,000</td></tr>
          <tr><td>편집 가이드 작성</td><td>운영 매뉴얼 및 검수표</td><td class="num">1</td><td class="num">500,000</td><td class="num">500,000</td></tr>
          <tr><th colspan="4">공급가액 합계</th><th class="num">2,000,000</th></tr>
          <tr><th colspan="4">부가가치세 (10%)</th><th class="num">200,000</th></tr>
          <tr><th colspan="4">총 합계 금액</th><th class="num">2,200,000</th></tr>
        </tbody>
      </table>
    </section>
    <section class="callout">
      <strong>결제 및 납품 조건:</strong> 계약 확정 후 2주 이내 납품, 검수 완료 후 15일 이내 계좌 이체.
    </section>`,
    ),
  },
]

export function findPracticalHtmlTemplate(
  id: PracticalHtmlTemplateId | string,
): PracticalHtmlTemplate | undefined {
  return PRACTICAL_HTML_TEMPLATES.find((t) => t.id === id)
}
