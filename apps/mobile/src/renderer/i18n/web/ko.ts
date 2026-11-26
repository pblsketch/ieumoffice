import type { zh } from './zh'

export const ko = {
  webNotUtf8Notice: 'UTF-8이 아닌 글자 방식이라 고칠 수 없습니다. 보기와 원본 공유는 됩니다.',
} as const satisfies Record<keyof typeof zh, string>
