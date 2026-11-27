import type { zh } from './zh'

export const ko = {
  staleDialogTitle: '새로 고침이 필요한 항목이 있습니다',
  staleDialogBody:
    '문서가 바뀐 뒤 아래 항목이 아직 최신 상태가 아닙니다. 진행하기 전에 새로 고칠까요?',
  staleActionSave: '저장',
  staleActionPrint: '인쇄',
  staleActionPdf: 'PDF 내보내기',
  staleActionSubmission: '제출본 저장',
  staleBtnRefreshAll: '모두 새로 고치기',
  staleBtnContinue: '그대로 진행',
  staleBtnCancel: '취소',
  staleReasonPagesChanged: '쪽 번호가 바뀜',
  staleReasonEntriesChanged: '항목 내용이 바뀜',
  staleKindTocBody: '차례',
  staleKindTocTable: '표 차례',
  staleKindTocFigure: '그림 차례',
  staleKindTocEquation: '수식 차례',
  staleKindIndex: '찾아보기',
  staleKindBibliography: '참고문헌',
  staleManualConfirmTitle: '직접 고친 내용이 있습니다',
  staleManualConfirmBody:
    '다음 항목에 직접 고친 내용이 있어 건너뛰었습니다: {items}. 덮어쓰고 새로 고칠까요?',
  staleManualOverwrite: '덮어쓰고 새로 고치기',
  staleManualSkip: '건너뛰기',
  staleRefreshDone: '{count}개 항목을 새로 고쳤습니다.',
  staleRefreshFailed: '일부 항목을 새로 고치지 못했습니다: {error}',
  submissionMenuLabel: '제출본으로 저장…',
  submissionMenuDesc: '색인·인용·설정 표식을 뺀 깨끗한 복사본을 따로 저장합니다.',
  submissionSaving: '제출본을 만드는 중…',
  submissionSaved: '제출본을 저장했습니다: {name}',
  submissionSavedTailsLost:
    '제출본을 저장했습니다({name}). 일부 바탕쪽이나 메모는 빠졌을 수 있습니다.',
  submissionFailedProtected: '암호가 걸린 문서는 제출본으로 저장할 수 없습니다.',
  submissionFailedTracked: '변경 내용 추적이 있는 문서는 제출본으로 저장할 수 없습니다.',
  submissionFailedVerify:
    '제출본 확인에 실패해 저장을 중단했습니다({before}쪽 → {after}쪽). HWPX 형식으로 다시 시도해 보세요.',
  submissionFailedExport: '제출본을 만들지 못했습니다: {error}',
  submissionFailedWrite: '제출본을 저장하지 못했습니다: {error}',
} satisfies Record<keyof typeof zh, string>
