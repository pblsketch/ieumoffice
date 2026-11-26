import type { zh } from './zh'

export const ko = {
  sheetsEditorName: '엑셀',
  sheetsLoading: '격자를 불러오는 중…',
  sheetsOpening: '문서를 여는 중… 큰 파일은 조금 걸립니다.',
  sheetsPasswordTitle: '암호로 보호된 문서',
  sheetsPasswordMessage: '이 문서를 열려면 암호를 입력하세요.',
  sheetsPasswordLabel: '암호',
  sheetsPasswordWrong: '암호가 맞지 않습니다. 다시 입력하세요.',
  sheetsPasswordOpen: '열기',
  sheetsPasswordCancel: '취소',
  sheetsEncryptionUnsupported: '이 암호 방식은 열 수 없습니다.',
  sheetsEncryptionDamaged: '암호 문서가 손상되어 열 수 없습니다.',
  sheetsNoticeMacros: '매크로는 그대로 두지만 실행하지 않습니다.',
  sheetsNoticeExternalLinks: '다른 파일을 가리키는 칸은 마지막에 저장된 값으로 보입니다.',
  sheetsNoticeMacrosAndLinks:
    '매크로는 그대로 두지만 실행하지 않습니다. 다른 파일을 가리키는 칸은 마지막에 저장된 값으로 보입니다.',
} as const satisfies Record<keyof typeof zh, string>
