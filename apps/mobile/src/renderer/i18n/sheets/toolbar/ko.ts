import type { zh } from './zh'

export const ko = {
  sheetsToolbarFormat: '셀 서식',
  sheetsToolbarRows: '행·열',
  sheetsToolbarSort: '정렬·필터',
  sheetsToolbarInsert: '삽입',
  sheetsToolbarInsertValues: '날짜·시트',
  sheetsToolbarToday: '오늘 날짜',
  sheetsToolbarTimeNow: '지금 시각',
  sheetsToolbarNewSheet: '새 시트',
  sheetsToolbarFind: '찾기',
  sheetsToolbarViewOnly: '차트·피벗 표·조건부 서식은 보기만 됩니다. 고치려면 PC에서 여세요.',
  sheetsToolbarFullLoaded: '통합 문서를 모두 불러왔습니다. 정렬이나 필터를 다시 누르세요.',
} as const satisfies Record<keyof typeof zh, string>
