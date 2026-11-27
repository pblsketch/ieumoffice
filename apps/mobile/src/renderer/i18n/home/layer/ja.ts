import type { zh } from './zh'

export const ja = {
  homeRunEditorOffTitle: '{name}エディターがオフになっています',
  homeRunEditorOffBody: 'オンにするとこのファイルを開けます。設定からいつでもオフに戻せます。',
  homeRunEditorOffConfirm: 'オンにして開く',
  homeRunStripSample: 'サンプル文書 · 読み取り専用',
  homeRunStripReceived: '受け取ったファイル · 読み取り専用',
  homeRunStripReadOnly: '読み取り専用',
  homeRunStripCopy: 'コピーを編集',
  homeRunStripClose: 'お知らせを閉じる',
  homeRunReceiveTitle: '受け取ったファイル',
  homeRunReceiveCount: '{count} 個のファイル',
  homeRunReceiveClose: '受け取ったファイルを閉じる',
  homeRunReceiveOpen: '開く',
  homeRunReceivePdfOff: 'PDF ツールがオフになっています',
  homeRunReceivePdfOn: 'オンにして続ける',
  homeRunGuideLabel: 'はじめてのご案内',
  homeRunWelcomeTitle: 'ようこそ',
  homeRunWelcomeBody:
    'GenOffice で HWP・PDF・Markdown などの文書を開いて編集できます。アカウントも広告もなく、文書はこの端末の中だけに保存されます。',
  homeRunStart: 'はじめる',
  homeRunTipEditButton: '変更するには [編集] をタップ',
  homeRunTipFlowView: '読みやすいリーディングビューに切り替えました · ページビューはこちら',
  homeRunTipFirstEdit:
    '復元用のコピーを自動で作ります。元のファイルは [完了] をタップしたときに保存されます',
  homeRunTipFirstKeyboard: '[Aa] で文字の書式を変更できます',
} as const satisfies Record<keyof typeof zh, string>
