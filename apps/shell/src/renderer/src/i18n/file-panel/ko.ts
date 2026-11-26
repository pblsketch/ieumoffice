import type { zh } from './zh'

export const ko = {
  panelTitle: '파일',
  showPanel: '파일 목록 열기',
  hidePanel: '파일 목록 닫기',
  searchPlaceholder: '파일 찾기',
  sectionCurrent: '이 문서가 있는 폴더',
  sectionFolders: '폴더',
  sectionRecent: '최근 문서',
  addFolder: '폴더 추가',
  refresh: '새로 고침',
  collapseAll: '모두 접기',
  emptyFolder: '열 수 있는 문서가 없습니다',
  folderMissing: '폴더를 찾을 수 없습니다',
  untitledHint: '아직 저장하지 않은 문서입니다. 저장하면 여기에 문서가 있는 폴더가 보입니다.',
  noResults: '맞는 파일이 없습니다',
  openMark: '열려 있음',
  resizePanel: '파일 목록 너비 조절',
  noRecent: '최근 문서가 없습니다',
  searching: '찾는 중…',
  quickLook: '빠른 미리보기',
} satisfies Record<keyof typeof zh, string>
