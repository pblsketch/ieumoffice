import type { zh } from './zh'

export const ko = {
  sheetsShareFailed: '이 파일을 공유하지 못했습니다.',
  sheetsSaveFailed: '저장하지 못했습니다. 원본 파일은 그대로입니다.',
  sheetsSaveAsTitle: '다른 이름으로 저장',
  sheetsShareTitle: '공유할 형식',
  sheetsFormatWorkbook: '엑셀 통합 문서 (.xlsx)',
  sheetsFormatWorkbookMacro: '엑셀 매크로 사용 통합 문서 (.xlsm)',
  sheetsFormatCsv: 'CSV (지금 시트만)',
  sheetsFormatOds: 'ODS 스프레드시트 (통합 문서 사본)',
  sheetsFormatPdf: 'PDF (지금 시트)',
  sheetsOdsEncrypted: '암호가 걸린 문서는 ODS로 내보낼 수 없습니다.',
  sheetsChoiceCancel: '취소',
  sheetsCsvAskTitle: 'CSV 파일 저장',
  sheetsCsvAskMessage: 'CSV에는 지금 시트의 값만 담깁니다.',
  sheetsCsvAskCsv: 'CSV로 저장 (서식·다른 시트는 빠짐)',
  sheetsCsvAskXlsx: '엑셀 파일로 저장',
  sheetsCsvFormulaTitle: '수식은 값으로만 남습니다',
  sheetsCsvFormulaMessage:
    '이 시트의 수식은 CSV에 계산된 값으로만 남습니다. 수식을 지키려면 엑셀 파일로 저장하세요.',
  sheetsCsvContinue: 'CSV로 계속',
  sheetsOdsLossTitle: 'ODS로 내보내기',
  sheetsOdsLossMessage:
    'ODS에 담을 수 없는 기능 {count}개(수식·차트·그림·조건부 서식 등)는 사본에서 빠집니다.',
  sheetsOdsContinue: '계속',
  sheetsOdsUnreadable: '만든 ODS 파일을 다시 열 수 없어 쓰지 않았습니다.',
  sheetsOdsFailed: 'ODS로 내보내지 못했습니다.',
  sheetsCopySaved: '사본을 저장했습니다: {name}',
  sheetsPdfWorking: 'PDF를 만드는 중입니다…',
  sheetsPdfFailed: 'PDF를 만들지 못했습니다.',
  sheetsPdfSkippedVisuals: '그림·차트 {count}개는 PDF에 넣지 못했습니다.',
  sheetsPdfMissingGlyphs: '글꼴에 없는 글자 {count}개는 PDF에서 빈 상자로 나옵니다.',
  sheetsSaveErrDiskChanged:
    '연 뒤에 다른 앱이 원본을 바꿨습니다. 덮어쓰지 않았으니 다른 이름으로 저장하세요.',
  sheetsSaveErrTooLarge:
    '파일이 커서(약 14MB 넘음) 휴대폰에서 쓰지 못했습니다. 원본은 그대로입니다.',
  sheetsSaveErrUnreadable: '저장한 결과를 다시 열 수 없어 원본은 그대로 두었습니다.',
  sheetsSaveErrLockFailed: '같은 암호로 다시 잠그지 못해 원본은 그대로 두었습니다.',
  sheetsSaveBusy: '저장하는 중입니다. 끝난 뒤 다시 해 주세요.',
} as const satisfies Record<keyof typeof zh, string>
