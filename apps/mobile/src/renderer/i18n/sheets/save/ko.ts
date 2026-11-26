import type { zh } from './zh'

export const ko = {
  sheetsShareFailed: '이 파일을 공유하지 못했습니다.',
  sheetsSaveFailed: '저장하지 못했습니다. 원본 파일은 그대로입니다.',
  sheetsSaveNotYet: '이 문서는 아직 휴대폰에서 저장할 수 없습니다.',
} as const satisfies Record<keyof typeof zh, string>
