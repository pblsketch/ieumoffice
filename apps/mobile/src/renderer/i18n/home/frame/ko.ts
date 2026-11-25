import type { zh } from './zh'

export const ko = {
  homeTabNav: '홈 메뉴',
  homeTabRecent: '최근',
  homeTabFolders: '폴더',
  homeTabTools: '도구',
  homeTabSettings: '설정',
  homeListAll: '전체',
  homeListFavorites: '즐겨찾기',
  homeListChips: '목록 거르기',
  homeListFamilyHwp: '한글',
  homeListFamilyMd: '마크다운',
  homeListFavoritesEmpty:
    '즐겨찾기한 파일이 아직 없어요. 파일의 [⋯]에서 즐겨찾기에 추가할 수 있어요.',
  homeListGroupEmpty: '이 그룹에 든 파일이 아직 없어요.',
  homeListFavoriteLost: '이 파일을 열 수 없어요. 옮겨졌거나 지워졌을 수 있어요.',
  homeEmptyText: '아직 연 문서가 없어요. 예시 문서를 보거나 파일을 열어 시작해 보세요.',
  homeEmptySample: '예시 문서 열어 보기',
  homeEmptyCreate: '새로 만들기',
  homeCreateFab: '새로 만들기',
  homeCreateTitle: '새로 만들기',
  homeCreateClose: '닫기',
  homeCreatePdfTools: 'PDF 도구',
} as const satisfies Record<keyof typeof zh, string>
