import type { zh } from './zh'

export const ja = {
  homeFolderListLabel: 'リンクしたフォルダー',
  homeFolderEmptyTitle: 'まだフォルダーをリンクしていません',
  homeFolderEmptyBody:
    'よく使うフォルダーをリンクすると、その中の文書や写真がここにすぐ表示されます。',
  homeFolderLink: 'フォルダーを追加',
  homeFolderRelink: 'もう一度リンク',
  homeFolderRelinkNamed: '{name}をもう一度リンク',
  homeFolderOk: 'リンク済み',
  homeFolderLostRevoked:
    'このフォルダーへのアクセス許可がなくなりました。もう一度リンクしてください。',
  homeFolderLostMissing:
    'このフォルダーが見つかりません。移動または削除した場合は、もう一度リンクしてください。',
  homeFolderLost: 'フォルダーにアクセスできません。もう一度リンクしてください。',
  homeFolderMenu: '{name}のメニュー',
  homeFolderRemove: '外す',
  homeFolderRemoveTitle: 'フォルダー「{name}」を外しますか？',
  homeFolderRemoveBody:
    'このフォルダー内のファイルの最近・お気に入りの項目 {count} 件も一緒に外れます。ファイル自体は削除されません。',
  homeFolderRemoved: 'フォルダーを外しました。',
  homeFolderBack: '上のフォルダーへ',
  homeFolderPath: '現在のフォルダー',
  homeFolderSubfolder: 'フォルダー',
  homeFolderInsideEmpty: 'このフォルダーには開ける文書や写真がありません。',
} as const satisfies Record<keyof typeof zh, string>
