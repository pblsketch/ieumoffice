import type { zh } from './zh'

export const ja = {
  sheetsEditorName: 'Excel',
  sheetsLoading: 'グリッドを読み込んでいます…',
  sheetsOpening: 'ブックを開いています…大きなファイルは少し時間がかかります。',
  sheetsPasswordTitle: 'パスワードで保護されたブック',
  sheetsPasswordMessage: 'このブックを開くにはパスワードを入力してください。',
  sheetsPasswordLabel: 'パスワード',
  sheetsPasswordWrong: 'パスワードが正しくありません。もう一度入力してください。',
  sheetsPasswordOpen: '開く',
  sheetsPasswordCancel: 'キャンセル',
  sheetsEncryptionUnsupported: 'この暗号化方式は開けません。',
  sheetsEncryptionDamaged: '保護されたブックが破損しているため開けません。',
  sheetsNoticeMacros: 'マクロはそのまま残しますが、実行しません。',
  sheetsNoticeExternalLinks: '他のファイルを参照するセルは、最後に保存された値で表示されます。',
  sheetsNoticeMacrosAndLinks:
    'マクロはそのまま残しますが、実行しません。他のファイルを参照するセルは、最後に保存された値で表示されます。',
} as const satisfies Record<keyof typeof zh, string>
