import type { zh } from './zh'

export const ko = {
  pdfEditPen: '펜',
  pdfEditHighlighter: '형광펜',
  pdfEditTextBox: '글상자',
  pdfEditSign: '서명',
  pdfEditPages: '쪽 정리',
  pdfEditLink: '링크 넣기',
  pdfEditSaveFailed: '저장하지 못했습니다. 고친 내용은 그대로 있고 파일은 바뀌지 않았습니다.',
  pdfEditSaveSkipped: '{pages}쪽에서 고친 글자 일부를 저장하지 못했습니다.',
  pdfEditShareFailed: '공유하지 못했습니다.',
  pdfEditReloadFailed: '저장했지만 문서를 다시 불러오지 못했습니다. 파일을 다시 여세요.',
  pdfEditSignatureUnavailable: '서명은 아직 쓸 수 없습니다.',
  pdfEditSaveAsHint:
    '사본에서 형광펜·메모·그리기를 어떻게 할지 고릅니다. “페이지에 굽기”는 입력란까지 함께 굽고, “주석 빼기”는 링크와 입력란을 남깁니다.',
  pdfEditKeepAnnots: '주석 포함 (다른 앱에서 고칠 수 있음)',
  pdfEditFlattenAnnots: '페이지에 굽기 (모든 앱에서 보임)',
  pdfEditStripAnnots: '주석 빼기 (링크·입력란은 남김)',
  pdfEditSaveVerifyFailed:
    '{pages}쪽의 변경 사항을 온전히 기록할 수 없어 저장을 취소했으며 파일은 변경되지 않았습니다. 해당 편집을 실행 취소한 후 다시 시도하세요',
} as const satisfies Record<keyof typeof zh, string>
