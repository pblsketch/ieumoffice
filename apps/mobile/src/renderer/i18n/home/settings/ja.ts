import type { zh } from './zh'

export const ja = {
  homeSetEditorsTitle: 'エディター',
  homeSetEditorsHint:
    'オフにしたエディターは新規作成の一覧に出ません。すべてオフにするとすべてオンとして扱います。',
  homeSetEditorHwp: 'HWP',
  homeSetEditorMarkdown: 'Markdown',
  homeSetEditorPdfTools: 'PDF ツール',
  homeSetCardsTitle: 'ホーム画面の新規作成',
  homeSetCardShow: '{name}をホーム画面に表示',
  homeSetCardUp: '{name}を上へ',
  homeSetCardDown: '{name}を下へ',
  homeSetKeepScreenOn: '読んでいる間は画面を消さない',
  homeSetKeepScreenOnDesc: 'PDF・EPUB を読んだり PPT を発表したりしている間、画面が消えません。',
  homeSetFoldersTitle: '文書フォルダー',
  homeSetFoldersEmpty:
    'リンクしたフォルダーはありません。リンクすると「フォルダー」タブですぐに見られます。',
  homeSetFolderLink: 'フォルダーをリンク',
  homeSetFolderRelink: 'もう一度リンク',
  homeSetFolderRemove: '外す',
  homeSetFolderRemoveNamed: '{name}を外す',
  homeSetFolderOk: 'リンク済み',
  homeSetFolderLost:
    'このフォルダーにアクセスできません。移動または削除した場合は、もう一度リンクしてください。',
  homeSetFolderRemoveTitle: 'フォルダー「{name}」を外しますか？',
  homeSetFolderRemoveBody:
    'このフォルダー内のファイルの最近・お気に入りの項目 {count} 件も一緒に外れます。ファイル自体は削除されません。',
  homeSetBackupsTotal: '合計 {size}',
  homeSetStorageTitle: 'ストレージ',
  homeSetStorageRecovery: '復元用コピー',
  homeSetStorageTemp: '一時ファイル',
  homeSetStorageBackups: 'HWP オリジナルバックアップ',
  homeSetStorageClearTemp: '一時ファイルを削除',
  homeSetStorageClearRecovery: '復元用コピーをすべて削除',
  homeSetStorageClearTempTitle: '一時ファイルを削除しますか？',
  homeSetStorageClearTempBody:
    '共有や受け取りのときに一時的に作ったファイルを削除します。文書ファイルはそのままです。',
  homeSetStorageClearRecoveryTitle: '復元用コピーをすべて削除しますか？',
  homeSetStorageClearRecoveryBody:
    '保存していない変更は失われます。いま開いている文書の復元用コピーは残します。',
  homeSetStorageClearAction: '削除',
  homeSetStorageCleared: '{size}を空けました。',
  homeSetFailed: '処理できませんでした。少し待ってからもう一度お試しください。',
} as const satisfies Record<keyof typeof zh, string>
