import type { zh } from './zh'

export const ko = {
  pdfTextHint: '빈 곳을 누르면 글자를 넣고, 글자를 누르면 고칩니다.',
  pdfTextInputLabel: '넣을 글자',
  pdfTextEditLabel: '고칠 글자',
  pdfTextStyleBar: '글자 모양',
  pdfTextBold: '굵게',
  pdfTextSize: '글자 크기',
  pdfTextSizeDown: '글자 작게',
  pdfTextSizeUp: '글자 크게',
  pdfTextColor: '글자 색',
  pdfTextColorDocument: '문서 색 그대로',
  pdfTextFont: '글꼴',
  pdfTextFontDocument: '문서 글꼴',
  pdfTextBack: '뒤로',
  pdfTextDelete: '지우기',
  pdfTextDone: '확인',
  pdfTextCannotDraw: '이 글자는 넣을 수 없어요: {chars}',
  pdfTextFontSubstituted: '이 글자는 다른 글꼴로 바뀝니다: {chars}',
  pdfTextScannedPage: '글자가 없는 쪽이에요. 새 글자만 넣을 수 있어요.',
  pdfTextNoMatch: '이 글은 고칠 수 없어요. 문서에서 글자를 찾지 못했어요.',
  pdfTextOverflow: '고친 글이 아래 글과 겹쳐요. 글을 줄여 주세요.',
} as const satisfies Record<keyof typeof zh, string>
